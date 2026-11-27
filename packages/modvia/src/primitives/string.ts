import { defineCodec } from "../codec/core/define.ts";
import { compact } from "../codec/core/descriptor.ts";
import { builtinIssues } from "../codec/core/issues.ts";
import type { Failed, StatefulCodecContext, WithCodecTrait } from "../codec/core/types.ts";
import {
  assertNonNegativeSafeInt,
  validateLengthBounds,
  type LengthBounds,
} from "../scalars/bounds/length.ts";
import { sanitizeStatelessPattern } from "../scalars/string.ts";

/** 字符串编解码器自有链式方法特征 */
export interface StringTrait {
  /** 对称去除首尾空白（幂等规范化，始终在长度与正则守卫之前执行） */
  trim(): unknown;
  /** 限制最小 UTF-16 码元长度（非负安全整数） */
  minLength(min: number): unknown;
  /** 限制最大 UTF-16 码元长度（非负安全整数） */
  maxLength(max: number): unknown;
  /** 限制精确固定 UTF-16 码元长度（等价于同时设定相同 minLength 与 maxLength） */
  length(exact: number): unknown;
  /** 要求非空字符串（等价于 .minLength(1)） */
  nonEmpty(): unknown;
  /** 限制字符串必须匹配给定正则表达式（自动剥离有状态的 g/y 标志） */
  pattern(regex: RegExp): unknown;
}

/** 字符串双向编解码器，支持对称裁剪、长度约束与无状态正则链式派生 */
export type StringCodec<Encoded = string> = WithCodecTrait<string, Encoded, StringTrait>;

interface StringState extends LengthBounds {
  readonly trim: boolean;
  readonly pattern?: RegExp;
}

/** 两端对称：先按状态规范化（trim），再守卫长度与正则 */
function convertString(
  input: unknown,
  context: StatefulCodecContext<StringState>,
): string | Failed {
  if (typeof input !== "string") {
    return context.issue(builtinIssues.typeString());
  }
  const { trim, minLength, maxLength, pattern } = context.state;
  const value = trim ? input.trim() : input;
  if (minLength !== undefined && value.length < minLength) {
    return context.issue(builtinIssues.stringMinLength(minLength));
  }
  if (maxLength !== undefined && value.length > maxLength) {
    return context.issue(builtinIssues.stringMaxLength(maxLength));
  }
  if (pattern !== undefined && !pattern.test(value)) {
    return context.issue(builtinIssues.stringPattern(pattern.source));
  }
  return value;
}

const defaultStringCodec: StringCodec = defineCodec({
  state: { trim: false } as StringState,
  validate: validateLengthBounds,
  decode: convertString,
  encode: convertString,
  descriptor: (state) =>
    compact({
      kind: "string" as const,
      trim: state.trim,
      minLength: state.minLength,
      maxLength: state.maxLength,
      pattern: state.pattern?.source,
    }),
  methods: {
    trim: () => ({ trim: true }),
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
    pattern: (regex: RegExp) => ({ pattern: sanitizeStatelessPattern(regex) }),
  },
});

/** 字符串双向编解码器，可通过 .trim()、.minLength()、.maxLength()、.nonEmpty()、.pattern() 链式派生 */
export function string(): StringCodec {
  return defaultStringCodec;
}
