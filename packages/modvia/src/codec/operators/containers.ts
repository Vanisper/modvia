import { isPlainObject, writeOwnField } from "../../shared/object.ts";
import { INVALID } from "../core/collector.ts";
import { assertValueCodec, createCodec, executeCodec, promoteToCodec } from "../core/runtime.ts";
import type { Codec, CodecLike, InferEncoded, InferValue, ValueCodecInput } from "../core/types.ts";

export interface ArrayOptions {
  readonly minLength?: number;
  readonly maxLength?: number;
}

export type RecordShape<Key extends string, Value> = string extends Key
  ? Record<string, Value>
  : Partial<Record<Key, Value>>;

export type TupleValues<Items extends readonly CodecLike<unknown, unknown>[]> = {
  -readonly [Index in keyof Items]: InferValue<Items[Index]>;
};

export type TupleEncoded<Items extends readonly CodecLike<unknown, unknown>[]> = {
  -readonly [Index in keyof Items]: InferEncoded<Items[Index]>;
};

/**
 * 按元素规则双向编解码数组，可选限制数组长度范围，元素校验错误保留下标路径
 *
 * @description 仅接受值级 Codec；若数组作为对象字段需设别名或可选，请在 arrayOf 返回值上调用 .alias() 或 .optional()
 */
export function arrayOf<T, Encoded>(
  codec: ValueCodecInput<T, Encoded>,
  options: ArrayOptions = {},
): Codec<T[], Encoded[]> {
  assertValueCodec(codec, "arrayOf");

  const { minLength, maxLength } = options;
  if (minLength !== undefined && (!Number.isSafeInteger(minLength) || minLength < 0)) {
    throw new RangeError("minLength must be a non-negative safe integer");
  }
  if (maxLength !== undefined && (!Number.isSafeInteger(maxLength) || maxLength < 0)) {
    throw new RangeError("maxLength must be a non-negative safe integer");
  }
  if (minLength !== undefined && maxLength !== undefined && maxLength < minLength) {
    throw new RangeError("maxLength must be greater than or equal to minLength");
  }

  const itemCodec = promoteToCodec(codec);

  return createCodec<T[], Encoded[]>(
    (input, direction, collector) => {
      if (!Array.isArray(input)) {
        return collector.add("type.array", "Expected an array");
      }
      if (minLength !== undefined && input.length < minLength) {
        return collector.add("array.min_length", `Expected at least ${minLength} items`);
      }
      if (maxLength !== undefined && input.length > maxLength) {
        return collector.add("array.max_length", `Expected at most ${maxLength} items`);
      }

      const output: (T | Encoded)[] = [];
      let failed = false;

      for (let index = 0; index < input.length; index++) {
        collector.pushSegment(index);
        try {
          const converted = executeCodec(itemCodec, input[index], direction, collector);
          if (converted === INVALID) {
            failed = true;
          } else if (!failed) {
            output.push(converted);
          }
        } finally {
          collector.popSegment();
        }
      }

      return failed ? INVALID : (output as T[] | Encoded[]);
    },
    {
      descriptor: {
        kind: "array",
        item: itemCodec as Codec<unknown, unknown>,
        ...(minLength !== undefined ? { minLength } : {}),
        ...(maxLength !== undefined ? { maxLength } : {}),
      },
    },
  );
}

/** 编解码动态字符串键字典，每个属性值按 valueCodec 转换 */
export function recordOf<Value, EncodedValue>(
  valueCodec: ValueCodecInput<Value, EncodedValue>,
): Codec<Record<string, Value>, Record<string, EncodedValue>>;
/** 编解码受限键名与属性值的动态字典 */
export function recordOf<Key extends string, EncodedKey extends string, Value, EncodedValue>(
  keyCodec: ValueCodecInput<Key, EncodedKey>,
  valueCodec: ValueCodecInput<Value, EncodedValue>,
): Codec<RecordShape<Key, Value>, RecordShape<EncodedKey, EncodedValue>>;
export function recordOf(
  first: ValueCodecInput<unknown, unknown>,
  second?: ValueCodecInput<unknown, unknown>,
): Codec<Record<string, unknown>, Record<string, unknown>> {
  const keyInput = (second !== undefined ? first : undefined) as
    | CodecLike<string, string>
    | undefined;
  const valueInput = second ?? first;

  if (keyInput !== undefined) assertValueCodec(keyInput, "recordOf");
  assertValueCodec(valueInput, "recordOf");

  const keyCodec = keyInput !== undefined ? promoteToCodec(keyInput) : undefined;
  const valueCodec = promoteToCodec(valueInput);

  return createCodec<Record<string, unknown>, Record<string, unknown>>(
    (input, direction, collector) => {
      if (!isPlainObject(input)) {
        return collector.add("type.object", "Expected a plain object");
      }

      const output: Record<string, unknown> = {};
      let failed = false;

      for (const [rawKey, rawValue] of Object.entries(input)) {
        collector.pushSegment(rawKey);
        try {
          const convertedKey =
            keyCodec !== undefined ? executeCodec(keyCodec, rawKey, direction, collector) : rawKey;
          const convertedValue = executeCodec(valueCodec, rawValue, direction, collector);

          if (convertedKey === INVALID || convertedValue === INVALID) {
            failed = true;
            continue;
          }

          if (Object.hasOwn(output, convertedKey)) {
            collector.add(
              "record.duplicate_key",
              `Duplicate record key after conversion: ${convertedKey}`,
            );
            failed = true;
            continue;
          }

          if (!failed) {
            writeOwnField(output, convertedKey, convertedValue);
          }
        } finally {
          collector.popSegment();
        }
      }

      return failed ? INVALID : output;
    },
    {
      descriptor: {
        kind: "record",
        ...(keyCodec !== undefined ? { key: keyCodec } : {}),
        value: valueCodec,
      },
    },
  );
}

/** 按固定长度与各位置 Codec 双向编解码异构元组 */
export function tupleOf<const Items extends readonly ValueCodecInput<unknown, unknown>[]>(
  ...items: Items
): Codec<TupleValues<Items>, TupleEncoded<Items>> {
  for (const item of items) {
    assertValueCodec(item, "tupleOf");
  }

  const promotedItems = Object.freeze(items.map((item) => promoteToCodec(item)));

  type DecodedTuple = TupleValues<Items>;
  type EncodedTuple = TupleEncoded<Items>;

  return createCodec<DecodedTuple, EncodedTuple>(
    (input, direction, collector) => {
      if (!Array.isArray(input)) {
        return collector.add("type.array", "Expected an array");
      }
      if (input.length !== promotedItems.length) {
        return collector.add(
          "tuple.length",
          `Expected tuple of length ${promotedItems.length}, got ${input.length}`,
        );
      }

      const output: unknown[] = [];
      let failed = false;

      for (let index = 0; index < promotedItems.length; index++) {
        const itemCodec = promotedItems[index] as Codec<unknown, unknown>;
        collector.pushSegment(index);
        try {
          const converted = executeCodec(itemCodec, input[index], direction, collector);
          if (converted === INVALID) {
            failed = true;
          } else if (!failed) {
            output.push(converted);
          }
        } finally {
          collector.popSegment();
        }
      }

      return failed ? INVALID : (output as DecodedTuple | EncodedTuple);
    },
    {
      descriptor: {
        kind: "tuple",
        items: promotedItems,
      },
    },
  );
}
