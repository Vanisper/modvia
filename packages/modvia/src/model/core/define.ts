import { INVALID, type Invalid, type IssueCollector } from "../../codec/core/collector.ts";
import {
  createCodec,
  createField,
  executeCodec,
  extendCodec,
  isFieldDescriptor,
  isStandardCodec,
  promoteToCodec,
} from "../../codec/core/runtime.ts";
import type { CodecLike, PathSegment } from "../../codec/core/types.ts";
import { isObject, isPlainObject, writeOwnField } from "../../shared/object.ts";
import {
  missingField,
  readModelField,
  resolvedFieldsSymbol,
  resolveFields,
  type ResolvedField,
} from "./fields.ts";
import type { ApplyNaming, NamingKind, NamingStrategy } from "./naming.ts";
import type { FieldRecord, MergeFields, Model, ModelOf, PartialFields } from "./types.ts";

/** 声明对象字段契约并应用统一字段命名策略（显式 .from() 优先于模型级 naming） */
export function defineModel<const Fields extends FieldRecord, Kind extends NamingKind>(options: {
  readonly fields: Fields;
  readonly naming: NamingStrategy<Kind>;
}): ModelOf<ApplyNaming<Fields, Kind>>;
/** 声明对象字段契约，统一完成双向编解码、结构派生与静态类型推导 */
export function defineModel<const Fields extends FieldRecord>(options: {
  readonly fields: Fields;
}): ModelOf<Fields>;
export function defineModel<const Fields extends FieldRecord>(options: {
  readonly fields: Fields;
  readonly naming?: NamingStrategy<NamingKind>;
}): ModelOf<Fields> {
  if (!isPlainObject(options) || !isPlainObject(options.fields)) {
    throw new TypeError("defineModel requires an options object with a plain fields table");
  }
  if (options.naming !== undefined) {
    if (
      typeof options.naming !== "object" ||
      options.naming === null ||
      typeof options.naming.mapKey !== "function"
    ) {
      throw new TypeError("defineModel naming must be a valid NamingStrategy");
    }
  }
  const ownFields = snapshotOwnFields(options.fields, options.naming);
  const resolvedFields = resolveFields(ownFields);
  return createModel(ownFields, resolvedFields, (data) => data);
}

function createModel<Fields extends FieldRecord, Data, DTO, Out extends Data>(
  ownFields: Readonly<Fields>,
  resolvedFields: readonly ResolvedField[],
  factory: (data: Data) => Out,
): Model<Data, DTO, Out, Fields> {
  const sourceByKey = new Map<string, string>();
  for (const { key, source } of resolvedFields) {
    sourceByKey.set(key, source);
  }

  const decodeSegmentMapper = (segment: PathSegment): PathSegment =>
    typeof segment === "string" ? (sourceByKey.get(segment) ?? segment) : segment;

  const baseCodec = createCodec<Out, DTO>(
    (input, direction, collector) =>
      direction === "decode"
        ? decodeModelObject(resolvedFields, factory, input, collector)
        : encodeModelObject(resolvedFields, input, collector),
    { decodeSegmentMapper },
  );

  function partial(): ModelOf<PartialFields<Fields>>;
  function partial<const Key extends Exclude<keyof Fields, symbol>>(
    ...keys: readonly [Key, ...Key[]]
  ): ModelOf<PartialFields<Fields, Key>>;
  function partial(
    ...keys: readonly Exclude<keyof Fields, symbol>[]
  ): ModelOf<PartialFields<Fields>> {
    const selected =
      keys.length === 0
        ? undefined
        : new Set(
            keys.map((rawKey) => {
              const key = String(rawKey);
              if (!Object.hasOwn(ownFields, key)) {
                throw new RangeError(`Unknown model field: ${key}`);
              }
              return key;
            }),
          );

    const nextFields: Record<string, CodecLike<unknown, unknown>> = {};
    for (const [key, entry] of Object.entries(ownFields)) {
      const shouldOptionalize = selected === undefined || selected.has(key);
      writeOwnField(nextFields, key, shouldOptionalize ? toOptionalField(entry) : entry);
    }
    return defineModel({ fields: nextFields }) as unknown as ModelOf<PartialFields<Fields>>;
  }

  return extendCodec(
    baseCodec,
    {
      fields: ownFields,
      pick<const Key extends Exclude<keyof Fields, symbol>>(
        ...keys: readonly Key[]
      ): ModelOf<Pick<Fields, Key>> {
        const picked: Record<string, CodecLike<unknown, unknown>> = {};
        for (const rawKey of keys) {
          const key = String(rawKey);
          if (!Object.hasOwn(ownFields, key)) {
            throw new RangeError(`Unknown model field: ${key}`);
          }
          writeOwnField(picked, key, ownFields[key]);
        }
        return defineModel({ fields: picked }) as unknown as ModelOf<Pick<Fields, Key>>;
      },
      omit<const Key extends Exclude<keyof Fields, symbol>>(
        ...keys: readonly Key[]
      ): ModelOf<Omit<Fields, Key>> {
        const excluded = new Set<string>();
        for (const rawKey of keys) {
          const key = String(rawKey);
          if (!Object.hasOwn(ownFields, key)) {
            throw new RangeError(`Unknown model field: ${key}`);
          }
          excluded.add(key);
        }
        const remaining: Record<string, CodecLike<unknown, unknown>> = {};
        for (const [key, entry] of Object.entries(ownFields)) {
          if (!excluded.has(key)) {
            writeOwnField(remaining, key, entry);
          }
        }
        return defineModel({ fields: remaining }) as unknown as ModelOf<Omit<Fields, Key>>;
      },
      partial,
      extend<const Extra extends FieldRecord>(
        extraFields: Extra,
      ): ModelOf<MergeFields<Fields, Extra>> {
        if (!isPlainObject(extraFields)) {
          throw new TypeError("extend requires a plain fields object");
        }
        const merged: Record<string, CodecLike<unknown, unknown>> = {};
        for (const [key, entry] of Object.entries(ownFields)) {
          writeOwnField(merged, key, entry);
        }
        for (const [key, entry] of Object.entries(extraFields)) {
          writeOwnField(merged, key, entry);
        }
        return defineModel({ fields: merged }) as unknown as ModelOf<MergeFields<Fields, Extra>>;
      },
      withFactory<Next extends Data>(
        nextFactory: (data: Data) => Next,
      ): Model<Data, DTO, Next, Fields> {
        return createModel<Fields, Data, DTO, Next>(ownFields, resolvedFields, nextFactory);
      },
    },
    [[resolvedFieldsSymbol, resolvedFields]],
  );
}

function snapshotOwnFields<Fields extends FieldRecord>(
  fields: Fields,
  naming?: NamingStrategy<NamingKind>,
): Readonly<Fields> {
  const copy: Record<string, CodecLike<unknown, unknown>> = {};
  for (const [key, entry] of Object.entries(fields)) {
    const resolvedEntry = naming !== undefined ? applyNamingToEntry(key, entry, naming) : entry;
    writeOwnField(copy, key, resolvedEntry);
  }
  return Object.freeze(copy) as unknown as Readonly<Fields>;
}

function applyNamingToEntry(
  key: string,
  entry: CodecLike<unknown, unknown>,
  naming: NamingStrategy<NamingKind>,
): CodecLike<unknown, unknown> {
  if (isFieldDescriptor(entry)) {
    if (typeof entry.source === "string") return entry;
    return entry.from(naming.mapKey(key));
  }
  return promoteToCodec(entry).from(naming.mapKey(key));
}

function toOptionalField(entry: CodecLike<unknown, unknown>): CodecLike<unknown, unknown> {
  if (isFieldDescriptor(entry)) {
    const inner = isStandardCodec(entry.codec) ? entry.codec : promoteToCodec(entry);
    return createField(
      inner,
      typeof entry.source === "string" ? entry.source : undefined,
      "optional",
    );
  }
  return createField(promoteToCodec(entry), undefined, "optional");
}

function decodeModelObject<Data, Out extends Data>(
  resolvedFields: readonly ResolvedField[],
  factory: (data: Data) => Out,
  input: unknown,
  collector: IssueCollector,
): Out | Invalid {
  if (!isPlainObject(input)) {
    return collector.add("type.object", "Expected a plain object");
  }

  const data: Record<string, unknown> = {};
  let failed = false;

  for (const { key, source, presence, resolveDefault, codec } of resolvedFields) {
    if (!Object.hasOwn(input, source)) {
      if (presence === "optional") continue;
      if (presence === "defaulted" && resolveDefault !== undefined) {
        if (!failed) {
          writeOwnField(data, key, resolveDefault());
        }
        continue;
      }
      collector.pushSegment(source);
      collector.add("field.required", `Missing required field: ${source}`);
      collector.popSegment();
      failed = true;
      continue;
    }

    collector.pushSegment(source);
    try {
      const decoded = executeCodec(codec, input[source], "decode", collector);
      if (decoded === INVALID) {
        failed = true;
      } else if (!failed) {
        writeOwnField(data, key, decoded);
      }
    } finally {
      collector.popSegment();
    }
  }

  return failed ? INVALID : factory(data as Data);
}

function encodeModelObject<DTO>(
  resolvedFields: readonly ResolvedField[],
  input: unknown,
  collector: IssueCollector,
): DTO | Invalid {
  if (!isObject(input)) {
    return collector.add("type.object", "Expected a model object");
  }

  const output: Record<string, unknown> = {};
  let failed = false;

  for (const { key, source, presence, codec } of resolvedFields) {
    collector.pushSegment(key);
    try {
      const fieldValue = readModelField(input, key);
      if (fieldValue === missingField) {
        if (presence === "optional") continue;
        collector.add("field.required", `Missing model field: ${key}`);
        failed = true;
        continue;
      }

      const encoded = executeCodec(codec, fieldValue, "encode", collector);
      if (encoded === INVALID) {
        failed = true;
      } else if (!failed) {
        writeOwnField(output, source, encoded);
      }
    } finally {
      collector.popSegment();
    }
  }

  return failed ? INVALID : (output as DTO);
}
