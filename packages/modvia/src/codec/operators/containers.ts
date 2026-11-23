import {
  assertNonNegativeSafeInt,
  checkLengthBounds,
  validateLengthBounds,
  type LengthBounds,
} from "../../scalars/bounds/length.ts";
import { isPlainObject, writeOwnField } from "../../shared/object.ts";
import { INVALID } from "../core/collector.ts";
import {
  assertValueCodec,
  createCodec,
  createStatefulCodec,
  executeCodec,
  promoteToCodec,
  type InternalRunner,
} from "../core/runtime.ts";
import type {
  Codec,
  CodecLike,
  InferEncoded,
  InferValue,
  ValueCodecInput,
  WithCodecTrait,
} from "../core/types.ts";

/** 数组编解码器自有链式方法特征 */
export interface ArrayTrait {
  /** 限制数组最少元素个数（非负安全整数） */
  minLength(min: number): unknown;
  /** 限制数组最多元素个数（非负安全整数） */
  maxLength(max: number): unknown;
  /** 限制数组固定元素个数（等价于同时设定相同 minLength 与 maxLength） */
  length(exact: number): unknown;
  /** 要求非空数组（至少包含 1 个元素，等价于 .minLength(1)） */
  nonEmpty(): unknown;
}

/** 同构数组双向编解码器，支持元素数量上下界与非空约束链式派生 */
export type ArrayCodec<T, Encoded = T[]> = WithCodecTrait<T[], Encoded, ArrayTrait>;

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
 * 按元素规则双向编解码数组，元素校验错误保留下标路径，可通过 .minLength()、.maxLength()、.nonEmpty() 链式派生
 *
 * @description 仅接受值级 Codec；若数组作为对象字段需设别名或可选，请在 arrayOf 返回值上调用 .alias() 或 .optional()
 */
export function arrayOf<T, Encoded>(codec: ValueCodecInput<T, Encoded>): ArrayCodec<T, Encoded[]> {
  assertValueCodec(codec, "arrayOf");
  const itemCodec = promoteToCodec(codec);

  return createStatefulCodec({
    state: {} as LengthBounds,
    validate: validateLengthBounds,
    createRunner(state): InternalRunner<T[], Encoded[]> {
      return (input, direction, collector) => {
        if (!Array.isArray(input)) {
          return collector.add("type.array", "Expected an array");
        }
        const violation = checkLengthBounds(input.length, state);
        if (violation === "min_length") {
          return collector.add("array.min_length", `Expected at least ${state.minLength} items`);
        }
        if (violation === "max_length") {
          return collector.add("array.max_length", `Expected at most ${state.maxLength} items`);
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
      };
    },
    createDescriptor(state, description) {
      return {
        kind: "array",
        item: itemCodec as Codec<unknown, unknown>,
        ...(state.minLength !== undefined ? { minLength: state.minLength } : {}),
        ...(state.maxLength !== undefined ? { maxLength: state.maxLength } : {}),
        ...(description !== undefined ? { description } : {}),
      };
    },
    methods: {
      minLength: (min: number) => {
        assertNonNegativeSafeInt(min, "minLength");
        return { minLength: min };
      },
      maxLength: (max: number) => {
        assertNonNegativeSafeInt(max, "maxLength");
        return { maxLength: max };
      },
      length: (exact: number) => {
        assertNonNegativeSafeInt(exact, "length");
        return { minLength: exact, maxLength: exact };
      },
      nonEmpty: () => ({ minLength: 1 }),
    },
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
