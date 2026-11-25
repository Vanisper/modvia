import {
  assertNonNegativeSafeInt,
  validateLengthBounds,
  type LengthBounds,
} from "../../scalars/bounds/length.ts";
import { isPlainObject, writeOwnField } from "../../shared/object.ts";
import { promoteToCodec } from "../core/codec.ts";
import { defineCodec } from "../core/define.ts";
import { compact } from "../core/descriptor.ts";
import { assertValueCodec } from "../core/guards.ts";
import { builtinIssues, failIssue, pushIssue } from "../core/issues.ts";
import { createFamily } from "../core/trait.ts";
import type {
  Codec,
  CodecLike,
  DecodeContext,
  EncodeContext,
  InferEncoded,
  InferValue,
  StandardCodec,
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

/** 容器 handler 共用的子 Codec 运行能力（解码与编码两侧 context 的公共形态） */
type ChildRunner = Pick<DecodeContext, "fail" | "issue" | "failed"> & {
  run(child: CodecLike<unknown, unknown>, input: unknown, at?: string | number): unknown;
};

interface ArrayState extends LengthBounds {
  readonly item: StandardCodec;
}

function convertArray(input: unknown, context: ChildRunner, state: ArrayState): unknown[] {
  if (!Array.isArray(input)) {
    return failIssue(context, builtinIssues.typeArray());
  }
  const { minLength, maxLength } = state;
  if (minLength !== undefined && input.length < minLength) {
    return failIssue(context, builtinIssues.arrayMinLength(minLength));
  }
  if (maxLength !== undefined && input.length > maxLength) {
    return failIssue(context, builtinIssues.arrayMaxLength(maxLength));
  }
  const output: unknown[] = [];
  for (let index = 0; index < input.length; index++) {
    const converted = context.run(state.item, input[index], index);
    if (!context.failed(converted)) output.push(converted);
  }
  return output;
}

const arrayFamily = createFamily<ArrayState>({
  state: {} as ArrayState,
  validate: validateLengthBounds,
  decode: (input, context: DecodeContext<ArrayState>) =>
    convertArray(input, context, context.state),
  encode: (input, context: EncodeContext<ArrayState>) =>
    convertArray(input, context, context.state),
  descriptor: (state) =>
    compact({
      kind: "array" as const,
      item: state.item,
      minLength: state.minLength,
      maxLength: state.maxLength,
    }),
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

/**
 * 按元素规则双向编解码数组，元素校验错误保留下标路径，可通过 .minLength()、.maxLength()、.nonEmpty() 链式派生
 *
 * @description 仅接受值级 Codec；若数组作为对象字段需设别名或可选，请在 arrayOf 返回值上调用 .alias() 或 .optional()
 */
export function arrayOf<T, Encoded>(codec: ValueCodecInput<T, Encoded>): ArrayCodec<T, Encoded[]> {
  assertValueCodec(codec, "arrayOf");
  return arrayFamily({ item: promoteToCodec(codec) }) as unknown as ArrayCodec<T, Encoded[]>;
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
  const keyInput = second !== undefined ? first : undefined;
  const valueInput = second ?? first;
  if (keyInput !== undefined) assertValueCodec(keyInput, "recordOf");
  assertValueCodec(valueInput, "recordOf");

  const keyCodec =
    keyInput !== undefined
      ? (promoteToCodec(keyInput) as unknown as StandardCodec<string, string>)
      : undefined;
  const valueCodec: StandardCodec = promoteToCodec(valueInput);

  const convert = (input: unknown, context: ChildRunner): Record<string, unknown> => {
    if (!isPlainObject(input)) {
      return failIssue(context, builtinIssues.typeObject());
    }
    const output: Record<string, unknown> = {};
    for (const rawKey of Object.keys(input)) {
      const key = keyCodec === undefined ? rawKey : context.run(keyCodec, rawKey, rawKey);
      const value = context.run(valueCodec, input[rawKey], rawKey);
      if (context.failed(key) || context.failed(value)) continue;
      if (Object.hasOwn(output, key as string)) {
        pushIssue(context, builtinIssues.recordDuplicateKey(key as string), [rawKey]);
        continue;
      }
      writeOwnField(output, key as string, value);
    }
    return output;
  };

  return defineCodec<Record<string, unknown>, Record<string, unknown>>({
    decode: convert,
    encode: convert,
    descriptor: compact({ kind: "record" as const, key: keyCodec, value: valueCodec }),
  });
}

/** 按固定长度与各位置 Codec 双向编解码异构元组 */
export function tupleOf<const Items extends readonly ValueCodecInput<unknown, unknown>[]>(
  ...items: Items
): Codec<TupleValues<Items>, TupleEncoded<Items>> {
  for (const item of items) {
    assertValueCodec(item, "tupleOf");
  }
  const promoted: readonly StandardCodec[] = Object.freeze(
    items.map((item) => promoteToCodec(item)),
  );

  const convert = (input: unknown, context: ChildRunner): unknown[] => {
    if (!Array.isArray(input)) {
      return failIssue(context, builtinIssues.typeArray());
    }
    if (input.length !== promoted.length) {
      return failIssue(context, builtinIssues.tupleLength(promoted.length, input.length));
    }
    return promoted.map((item, index) => context.run(item, input[index], index));
  };

  return defineCodec({
    decode: convert,
    encode: convert,
    descriptor: { kind: "tuple", items: promoted },
  }) as unknown as Codec<TupleValues<Items>, TupleEncoded<Items>>;
}
