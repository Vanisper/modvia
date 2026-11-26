import {
  CodecImpl,
  rebuildWithDescription,
  rebuildWithStandard,
  toField,
  type StandardExtension,
} from "../../codec/core/codec.ts";
import { INVALID, type IssueCollector } from "../../codec/core/collector.ts";
import { compact } from "../../codec/core/descriptor.ts";
import type { Kernel } from "../../codec/core/internals.ts";
import { builtinIssues, reportIssue, reportIssueAt } from "../../codec/core/issues.ts";
import type { CodecOrField } from "../../codec/core/types.ts";
import { isObject, isPlainObject, writeOwnField } from "../../shared/object.ts";
import type { Alias, AliasKind, ApplyAlias } from "./alias.ts";
import { missingField, readModelField, resolveFields, type ResolvedField } from "./fields.ts";
import type { FieldRecord, Model, ModelOf } from "./types.ts";

/** 模型的完整不可变状态：字段表（已绑定别名）、单层严格边界、实例工厂与说明 */
interface ModelSpec {
  readonly fields: FieldRecord;
  readonly strict: boolean;
  readonly factory?: ((data: unknown) => unknown) | undefined;
  readonly description?: string | undefined;
  /** Standard Schema 扩展属性：只属于当前实例，任何派生都不继承 */
  readonly standard?: StandardExtension | undefined;
}

/**
 * 领域模型实现
 *
 * @description 结构派生（pick / omit / partial / extend）基于字段表重建并重置工厂与说明；
 * 同阶派生（strict / describe / withFactory）只改写 spec 中对应槽位
 */
class ModelImpl extends CodecImpl {
  readonly fields: FieldRecord;
  readonly #spec: ModelSpec;

  constructor(spec: ModelSpec) {
    super(
      modelKernel(resolveFields(spec.fields), spec),
      compact({
        kind: "model" as const,
        fields: spec.fields,
        strict: spec.strict,
        description: spec.description,
      }),
      spec.standard,
    );
    this.fields = spec.fields;
    this.#spec = spec;
  }

  pick(...keys: readonly string[]): ModelImpl {
    const picked: Record<string, CodecOrField> = {};
    for (const key of this.#knownKeys(keys)) {
      writeOwnField(picked, key, this.fields[key]);
    }
    return this.#derive(picked);
  }

  omit(...keys: readonly string[]): ModelImpl {
    const excluded = new Set(this.#knownKeys(keys));
    return this.#derive(this.#mapFields((key, entry) => (excluded.has(key) ? undefined : entry)));
  }

  partial(...keys: readonly string[]): ModelImpl {
    const selected = keys.length === 0 ? undefined : new Set(this.#knownKeys(keys));
    return this.#derive(
      this.#mapFields((key, entry) =>
        selected === undefined || selected.has(key) ? toField(entry).optional() : entry,
      ),
    );
  }

  extend(extraFields: FieldRecord): ModelImpl {
    if (!isPlainObject(extraFields)) {
      throw new TypeError("extend requires a plain fields object");
    }
    const merged = this.#mapFields((_key, entry) => entry);
    for (const [key, entry] of Object.entries(extraFields)) {
      writeOwnField(merged, key, entry);
    }
    return this.#derive(merged);
  }

  strict(): ModelImpl {
    return this.#spec.strict ? this : instantiateModel({ ...this.#derivable(), strict: true });
  }

  withFactory(factory: (data: unknown) => unknown): ModelImpl {
    if (typeof factory !== "function") {
      throw new TypeError("withFactory requires a factory function");
    }
    return instantiateModel({ ...this.#derivable(), factory });
  }

  override [rebuildWithDescription](description: string): ModelImpl {
    return instantiateModel({ ...this.#derivable(), description });
  }

  override [rebuildWithStandard](standard: StandardExtension): ModelImpl {
    return instantiateModel({ ...this.#spec, standard });
  }

  /** 同阶派生沿用的 spec：Standard Schema 扩展只属于当前实例，不随派生传播 */
  #derivable(): ModelSpec {
    const { standard: _instanceOnly, ...spec } = this.#spec;
    return spec;
  }

  #knownKeys(keys: readonly unknown[]): string[] {
    return keys.map((rawKey) => {
      const key = String(rawKey);
      if (!Object.hasOwn(this.fields, key)) {
        throw new RangeError(`Unknown model field: ${key}`);
      }
      return key;
    });
  }

  #mapFields(
    select: (key: string, entry: CodecOrField) => CodecOrField | undefined,
  ): Record<string, CodecOrField> {
    const output: Record<string, CodecOrField> = {};
    for (const [key, entry] of Object.entries(this.fields)) {
      const next = select(key, entry);
      if (next !== undefined) writeOwnField(output, key, next);
    }
    return output;
  }

  /** 结构派生：沿用单层严格边界，重置工厂与说明 */
  #derive(fields: Record<string, CodecOrField>): ModelImpl {
    return instantiateModel({ fields: Object.freeze(fields), strict: this.#spec.strict });
  }
}

function instantiateModel(spec: ModelSpec): ModelImpl {
  const model = new ModelImpl(spec);
  Object.freeze(model);
  return model;
}

/** 声明对象字段契约并应用统一字段外部键别名策略（显式 .alias() 优先于模型级 alias） */
export function defineModel<const Fields extends FieldRecord, Kind extends AliasKind>(options: {
  readonly fields: Fields;
  readonly alias: Alias<Kind>;
}): ModelOf<ApplyAlias<Fields, Kind>>;
/** 声明对象字段契约，统一完成双向编解码、结构派生与静态类型推导 */
export function defineModel<const Fields extends FieldRecord>(options: {
  readonly fields: Fields;
}): ModelOf<Fields>;
export function defineModel(options: {
  readonly fields: FieldRecord;
  readonly alias?: Alias<AliasKind>;
}): Model<unknown, unknown> {
  if (!isPlainObject(options) || !isPlainObject(options.fields)) {
    throw new TypeError("Model.define requires an options object with a plain fields table");
  }
  const { alias } = options;
  if (
    alias !== undefined &&
    (typeof alias !== "object" || alias === null || typeof alias.mapKey !== "function")
  ) {
    throw new TypeError("Model.define alias must be a valid Alias strategy");
  }
  const fields: Record<string, CodecOrField> = {};
  for (const [key, entry] of Object.entries(options.fields)) {
    writeOwnField(fields, key, alias === undefined ? entry : bindAlias(key, entry, alias));
  }
  return instantiateModel({ fields: Object.freeze(fields), strict: false }) as never;
}

/** 为未显式声明外部键的字段按模型级策略绑定别名 */
function bindAlias(key: string, entry: CodecOrField, alias: Alias<AliasKind>): CodecOrField {
  const field = toField(entry);
  return field.source !== undefined ? entry : field.alias(alias.mapKey(key));
}

/** 模型执行内核：解码按外部键读取普通对象，编码按业务键读取自有属性或原型 getter */
function modelKernel(fields: readonly ResolvedField[], spec: ModelSpec): Kernel {
  const knownSources = spec.strict ? new Set(fields.map((field) => field.source)) : undefined;
  return {
    decode: (input, collector) => decodeModel(fields, knownSources, spec.factory, input, collector),
    encode: (input, collector) => encodeModel(fields, input, collector),
  };
}

function decodeModel(
  fields: readonly ResolvedField[],
  knownSources: ReadonlySet<string> | undefined,
  factory: ((data: unknown) => unknown) | undefined,
  input: unknown,
  collector: IssueCollector,
): unknown {
  if (!isPlainObject(input)) {
    return reportIssue(collector, builtinIssues.typeObject());
  }

  const data: Record<string, unknown> = {};
  let failed = false;

  for (const field of fields) {
    const { source } = field;
    if (!Object.hasOwn(input, source)) {
      if (field.presence === "optional") continue;
      if (field.fallback !== undefined) {
        if (!failed) writeOwnField(data, field.key, field.fallback());
        continue;
      }
      reportIssueAt(collector, source, builtinIssues.objectMissingKey(source, "decode"));
      failed = true;
      continue;
    }
    collector.pushSegment(source);
    const decoded = field.kernel.decode(input[source], collector);
    collector.popSegment();
    if (decoded === INVALID) failed = true;
    else if (!failed) writeOwnField(data, field.key, decoded);
  }

  if (knownSources !== undefined) {
    for (const rawKey of Object.keys(input)) {
      if (!knownSources.has(rawKey)) {
        reportIssueAt(collector, rawKey, builtinIssues.objectUnknownKey(rawKey));
        failed = true;
      }
    }
  }

  if (failed) return INVALID;
  return factory !== undefined ? factory(data) : data;
}

function encodeModel(
  fields: readonly ResolvedField[],
  input: unknown,
  collector: IssueCollector,
): unknown {
  if (!isObject(input)) {
    return reportIssue(collector, builtinIssues.typeObject("model"));
  }

  const output: Record<string, unknown> = {};
  let failed = false;

  for (const field of fields) {
    const { key } = field;
    const value = readModelField(input, key);
    if (value === missingField) {
      if (field.presence === "optional") continue;
      reportIssueAt(collector, key, builtinIssues.objectMissingKey(key, "encode"));
      failed = true;
      continue;
    }
    collector.pushSegment(key);
    const encoded = field.kernel.encode(value, collector);
    collector.popSegment();
    if (encoded === INVALID) failed = true;
    else if (!failed) writeOwnField(output, field.source, encoded);
  }

  return failed ? INVALID : output;
}
