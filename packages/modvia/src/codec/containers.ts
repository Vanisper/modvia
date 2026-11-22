import { INVALID } from "./collector.ts";
import { isPlainObject, writeOwnField } from "./object-utils.ts";
import { assertValueCodec, createCodec, executeCodec } from "./runtime.ts";
import type { Codec, CodecLike, ValueCodecInput } from "./types.ts";

export type RecordShape<Key extends string, Value> = string extends Key
  ? Record<string, Value>
  : Partial<Record<Key, Value>>;

/**
 * 按元素规则双向编解码数组，元素校验错误保留下标路径
 *
 * @description 仅接受值级 Codec；若数组作为对象字段需设别名或可选，请在 arrayOf 返回值上调用 .from() 或 .optional()
 */
export function arrayOf<T, Encoded>(codec: ValueCodecInput<T, Encoded>): Codec<T[], Encoded[]> {
  assertValueCodec(codec, "arrayOf");

  return createCodec<T[], Encoded[]>((input, direction, collector) => {
    if (!Array.isArray(input)) {
      return collector.add("type.array", "Expected an array");
    }

    const output: (T | Encoded)[] = [];
    let failed = false;

    for (let index = 0; index < input.length; index++) {
      collector.pushSegment(index);
      try {
        const converted = executeCodec(codec, input[index], direction, collector);
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
  });
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
  const keyCodec = (second !== undefined ? first : undefined) as
    | CodecLike<string, string>
    | undefined;
  const valueCodec = second ?? first;

  if (keyCodec !== undefined) assertValueCodec(keyCodec, "recordOf");
  assertValueCodec(valueCodec, "recordOf");

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
  );
}
