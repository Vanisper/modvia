import { deduplicateLiterals } from "../../shared/value.ts";
import { INVALID, IssueCollector } from "./collector.ts";
import { compact, pathMapperOf, refinedDescriptor } from "./descriptor.ts";
import { ValidationError } from "./errors.ts";
import { createField, isFieldInstance, isFieldLike, toFallback } from "./field.ts";
import {
  assertDescription,
  assertFunction,
  assertLiterals,
  assertSource,
  assertValueCodec,
} from "./guards.ts";
import { checkKernel, literalKernel, normalizeKernel, pipeKernel, refineKernel } from "./kernel.ts";
import {
  descriptorOf,
  isRegisteredCodec,
  kernelOf,
  registerCodec,
  type Kernel,
  type Step,
} from "./internals.ts";
import type {
  Codec,
  CodecContext,
  CodecDescriptor,
  CodecLike,
  CodecOrField,
  Field,
  FieldLike,
  FieldLiteral,
  FieldPresence,
  SafeResult,
  StandardCodec,
  StandardSchemaV1,
} from "./types.ts";

/** 子类重建钩子：describe 统一委托给它，由各类按自身完整状态派生同阶新实例 */
export const rebuildWithDescription = Symbol("modvia.rebuildWithDescription");
/** 子类重建钩子：以附加的 Standard Schema 扩展属性重建当前实例（扩展只属于该实例，后续派生不继承） */
export const rebuildWithStandard = Symbol("modvia.rebuildWithStandard");
/** 子类管道钩子：a.pipe(b) 统一委托给 b，带自有方法的族借此把 a 接入上游槽而非转发方法 */
export const prependUpstream = Symbol("modvia.prependUpstream");

/**
 * 标准 Codec 实现基类
 *
 * @description 执行方法（2×2 矩阵及 safe 变体）为构造期绑定的自有属性，可解构独立调用；
 * 构建方法位于原型并依赖 this；内核与描述符登记在模块私有表中，实例本身冻结不可变
 */
export class CodecImpl {
  readonly decode: (input: unknown) => unknown;
  readonly encode: (input: unknown) => unknown;
  readonly safeDecode: (input: unknown) => SafeResult<unknown>;
  readonly safeEncode: (input: unknown) => SafeResult<unknown>;
  readonly parse: (input: unknown) => unknown;
  readonly dump: (input: unknown) => unknown;
  readonly safeParse: (input: unknown) => SafeResult<unknown>;
  readonly safeDump: (input: unknown) => SafeResult<unknown>;
  readonly "~standard": StandardSchemaV1.Props;

  constructor(kernel: Kernel, descriptor: CodecDescriptor, standardExtension?: StandardExtension) {
    registerCodec(this, kernel, Object.freeze(descriptor));
    const parse = (input: unknown): unknown => runThrowing(kernel.decode, input);
    const dump = (input: unknown): unknown => runThrowing(kernel.encode, input);
    const safeParse = (input: unknown): SafeResult<unknown> => runSafe(kernel.decode, input);
    const safeDump = (input: unknown): SafeResult<unknown> => runSafe(kernel.encode, input);
    this.decode = parse;
    this.parse = parse;
    this.encode = dump;
    this.dump = dump;
    this.safeDecode = safeParse;
    this.safeParse = safeParse;
    this.safeEncode = safeDump;
    this.safeDump = safeDump;
    this["~standard"] = Object.freeze({
      ...standardExtension,
      version: 1,
      vendor: "modvia",
      validate(value: unknown): StandardSchemaV1.Result<unknown> {
        const result = safeParse(value);
        return result.ok ? { value: result.value } : { issues: result.issues };
      },
    });
  }

  check(rule: (value: unknown, context: CodecContext) => void): CodecImpl {
    assertFunction(rule, "check requires a validation function");
    return createCodec(
      checkKernel(kernelOf(this), rule, () => pathMapperOf(this)),
      refinedDescriptor(this as never, { kind: "check" }),
    );
  }

  refine(predicate: (value: unknown) => boolean, code: string, message: string): CodecImpl {
    assertFunction(predicate, "refine requires a predicate function");
    if (typeof code !== "string" || code.length === 0) {
      throw new TypeError("refine requires a non-empty error code");
    }
    if (typeof message !== "string") {
      throw new TypeError("refine requires an error message string");
    }
    return createCodec(
      refineKernel(kernelOf(this), predicate, code, message),
      refinedDescriptor(this as never, { kind: "refine", code }),
    );
  }

  normalize(fn: (value: unknown) => unknown): CodecImpl {
    assertFunction(fn, "normalize requires a transformation function");
    return createCodec(
      normalizeKernel(kernelOf(this), fn),
      refinedDescriptor(this as never, { kind: "normalize" }),
    );
  }

  brand(): this {
    return this;
  }

  describe(description: string): CodecImpl {
    assertDescription(description);
    return this[rebuildWithDescription](description);
  }

  pipe(next: CodecLike<unknown, unknown>): CodecImpl {
    assertValueCodec(next, "pipe");
    return promoteToCodec(next)[prependUpstream](this);
  }

  or(...values: readonly unknown[]): CodecImpl {
    assertLiterals(values);
    return extendWithLiterals(this, values);
  }

  nullable(): CodecImpl {
    return extendWithLiterals(this, [null]);
  }

  alias(source: string): Field<unknown, unknown, string, "required"> {
    assertSource(source);
    return createField({ codec: this as never, source, presence: "required" });
  }

  optional(): Field<unknown, unknown, undefined, "optional"> {
    return createField({ codec: this as never, source: undefined, presence: "optional" });
  }

  default(provider: unknown): Field<unknown, unknown, undefined, "defaulted"> {
    return createField({
      codec: this as never,
      source: undefined,
      presence: "defaulted",
      fallback: toFallback(provider),
    });
  }

  [rebuildWithDescription](description: string): CodecImpl {
    return createCodec(kernelOf(this), { ...descriptorOf(this), description });
  }

  [rebuildWithStandard](extension: StandardExtension): CodecImpl {
    return createCodec(kernelOf(this), descriptorOf(this), extension);
  }

  [prependUpstream](upstream: CodecImpl): CodecImpl {
    return createCodec(pipeKernel(kernelOf(upstream), kernelOf(this)), {
      kind: "pipe",
      first: upstream as never,
      second: this as never,
    });
  }
}

Object.defineProperty(CodecImpl.prototype, Symbol.toStringTag, { value: "modvia.Codec" });

/** Codec 核心协议成员名（执行方法与原型构建方法），自定义链式方法禁止覆盖 */
export const reservedCodecKeys: ReadonlySet<string> = new Set([
  ...Object.getOwnPropertyNames(CodecImpl.prototype),
  "decode",
  "encode",
  "safeDecode",
  "safeEncode",
  "parse",
  "dump",
  "safeParse",
  "safeDump",
  "~standard",
  "__proto__",
]);

/** Standard Schema 族规范的扩展属性（如 StandardJSONSchemaV1 的 jsonSchema），不得覆盖核心协议成员 */
export type StandardExtension = Readonly<Record<string, unknown>>;

const reservedStandardKeys = new Set(["version", "vendor", "validate", "types"]);

/** 由执行内核与结构描述符构造冻结的标准 Codec */
export function createCodec<T, Encoded>(
  kernel: Kernel<T, Encoded>,
  descriptor: CodecDescriptor,
  standardExtension?: StandardExtension,
): CodecImpl & Codec<T, Encoded> {
  const codec = new CodecImpl(kernel as Kernel, descriptor, standardExtension);
  Object.freeze(codec);
  return codec as CodecImpl & Codec<T, Encoded>;
}

/** 将任意 CodecLike 提升为标准 Codec：本副本实例原样返回，外部对象按公开协议适配 */
export function promoteToCodec<T, Encoded>(
  codec: CodecLike<T, Encoded>,
): CodecImpl & Codec<T, Encoded> {
  if (isRegisteredCodec(codec)) return codec as unknown as CodecImpl & Codec<T, Encoded>;
  return createCodec(kernelOf(codec), { kind: "custom" });
}

/**
 * 派生一个 `~standard` 合并了给定扩展属性的同构 Codec（保留全部方法、结构描述符与执行行为）
 *
 * @description 供 Standard Schema 族规范（如 StandardJSONSchemaV1）的适配包挂载能力；扩展只属于返回的实例，
 * 在其上继续派生（describe、链式方法、结构派生等）得到的新定义不继承扩展
 */
export function extendStandard<C extends StandardCodec, Extension extends object>(
  codec: C,
  extension: Extension,
): C & { readonly "~standard": C["~standard"] & Readonly<Extension> } {
  if (!isRegisteredCodec(codec)) {
    throw new TypeError("Codec.extendStandard requires a standard Modvia Codec instance");
  }
  if (typeof extension !== "object" || extension === null || Array.isArray(extension)) {
    throw new TypeError("Codec.extendStandard requires a plain extension object");
  }
  for (const key of Object.keys(extension)) {
    if (reservedStandardKeys.has(key)) {
      throw new RangeError(
        `Codec.extendStandard cannot override the core "~standard.${key}" member`,
      );
    }
  }
  return (codec as unknown as CodecImpl)[rebuildWithStandard](
    Object.freeze({ ...extension }),
  ) as never;
}

/** 判断目标值是否为本副本构造的标准 Codec */
export function isStandardCodec(value: unknown): value is Codec<unknown, unknown> {
  return isRegisteredCodec(value);
}

/** 将任意 Codec 或 FieldLike（含跨副本实例与展开拷贝）规范化为本副本 Field，模型字段表的唯一入口 */
export function toField(
  entry: CodecOrField,
): Field<unknown, unknown, string | undefined, FieldPresence> {
  if (isFieldInstance(entry)) return entry;
  if (isFieldLike(entry)) {
    const presence = normalizePresence(entry.presence);
    return createField({
      codec: promoteToCodec(entry.codec),
      source: typeof entry.source === "string" ? entry.source : undefined,
      presence,
      description: typeof entry.description === "string" ? entry.description : undefined,
      fallback:
        presence === "defaulted" && typeof entry.fallback === "function"
          ? entry.fallback
          : undefined,
    });
  }
  if (
    typeof entry !== "object" ||
    entry === null ||
    typeof entry.decode !== "function" ||
    typeof entry.encode !== "function"
  ) {
    throw new TypeError("Field.of requires a valid Codec, Field, or CodecLike object");
  }
  return createField({ codec: promoteToCodec(entry), source: undefined, presence: "required" });
}

/** 包装已有字段并保留外部键名、缺省性与属性说明 */
export function fieldOf<
  T,
  Encoded,
  Source extends string | undefined,
  Presence extends FieldPresence = "required",
>(input: FieldLike<T, Encoded, Source, Presence>): Field<T, Encoded, Source, Presence>;
/** 将任意 Codec 或自定义 CodecLike 转为字段描述符 */
export function fieldOf<T, Encoded>(input: CodecLike<T, Encoded>): Field<T, Encoded>;
export function fieldOf(
  input: CodecOrField,
): Field<unknown, unknown, string | undefined, FieldPresence> {
  return toField(input);
}

/** 判断目标值是否为带外部键名与缺省性元数据的 Field 描述符 */
export function isField<T, Encoded>(
  value: CodecOrField<T, Encoded>,
): value is FieldLike<T, Encoded, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is FieldLike<unknown, unknown, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is FieldLike<unknown, unknown, string | undefined, FieldPresence> {
  return isFieldLike(value);
}

function normalizePresence(presence: FieldPresence): FieldPresence {
  return presence === "optional" || presence === "defaulted" ? presence : "required";
}

/** 追加字面量哨兵：相邻 .or 按集合并集扁平合并，并保留外层已声明的说明 */
function extendWithLiterals(codec: CodecImpl, values: readonly FieldLiteral[]): CodecImpl {
  const descriptor = descriptorOf(codec);
  const merged = descriptor.kind === "or";
  const base = merged ? descriptor.base : (codec as never);
  const literals = deduplicateLiterals(merged ? descriptor.literals : [], values);
  return createCodec(
    literalKernel(kernelOf(base), literals),
    compact({
      kind: "or" as const,
      base,
      literals,
      description: merged ? descriptor.description : undefined,
    }),
  );
}

function runThrowing(step: Step<unknown>, input: unknown): unknown {
  const collector = new IssueCollector();
  const output = step(input, collector);
  if (output === INVALID) {
    throw new ValidationError(collector.frozenIssues());
  }
  return output;
}

function runSafe(step: Step<unknown>, input: unknown): SafeResult<unknown> {
  const collector = new IssueCollector();
  const output = step(input, collector);
  return output === INVALID
    ? Object.freeze({ ok: false, issues: collector.frozenIssues() })
    : Object.freeze({ ok: true, value: output });
}
