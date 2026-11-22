import { INVALID, type Invalid, type IssueCollector } from "../codec/collector.ts";
import { isObject, isPlainObject, writeOwnField } from "../codec/object-utils.ts";
import { createCodec, executeCodec, extendCodec } from "../codec/runtime.ts";
import type { CodecLike } from "../codec/types.ts";
import {
  missingField,
  readModelField,
  resolvedFieldsSymbol,
  resolveFields,
  type ResolvedField,
} from "./object.ts";
import type { FieldRecord, MergeFields, Model, ModelOf } from "./types.ts";

/** 声明对象字段契约，统一完成双向编解码、结构派生与静态类型推导 */
export function defineModel<const Fields extends FieldRecord>(options: {
  readonly fields: Fields;
}): ModelOf<Fields> {
  if (!isPlainObject(options) || !isPlainObject(options.fields)) {
    throw new TypeError("defineModel requires an options object with a plain fields table");
  }
  const ownFields = snapshotOwnFields(options.fields);
  const resolvedFields = resolveFields(ownFields);
  return createModel(ownFields, resolvedFields, (data) => data);
}

function createModel<Fields extends FieldRecord, Data, DTO, Out extends Data>(
  ownFields: Readonly<Fields>,
  resolvedFields: readonly ResolvedField[],
  factory: (data: Data) => Out,
): Model<Data, DTO, Out, Fields> {
  const baseCodec = createCodec<Out, DTO>((input, direction, collector) =>
    direction === "decode"
      ? decodeModelObject(resolvedFields, factory, input, collector)
      : encodeModelObject(resolvedFields, input, collector),
  );

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

function snapshotOwnFields<Fields extends FieldRecord>(fields: Fields): Readonly<Fields> {
  const copy: Record<string, CodecLike<unknown, unknown>> = {};
  for (const [key, entry] of Object.entries(fields)) {
    writeOwnField(copy, key, entry);
  }
  return Object.freeze(copy) as unknown as Readonly<Fields>;
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

  for (const { key, source, optional, codec } of resolvedFields) {
    if (!Object.hasOwn(input, source)) {
      if (optional) continue;
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

  for (const { key, source, optional, codec } of resolvedFields) {
    collector.pushSegment(key);
    try {
      const fieldValue = readModelField(input, key);
      if (fieldValue === missingField) {
        if (optional) continue;
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
