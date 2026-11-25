import { builtinIssues } from "../../codec/core/issues.ts";
import { validateDiscreteIntBounds, type OrderedViolation } from "../../scalars/bounds/ordered.ts";
import {
  assertSafeInteger,
  formatSafeInt,
  isSafeInteger,
  parseSafeIntString,
} from "../../scalars/numeric/int.ts";
import { createOrderedNumericCodec, type OrderedNumericCodec } from "./shared.ts";

/** 安全整数双向编解码器，默认编码为 number，经 .fromString() 切换后编码为 string */
export type IntCodec<Encoded = number> = OrderedNumericCodec<number, Encoded>;

const boundIssues = {
  min: builtinIssues.integerMin,
  max: builtinIssues.integerMax,
  gt: builtinIssues.integerGt,
  lt: builtinIssues.integerLt,
} as const;

const defaultIntCodec: IntCodec = createOrderedNumericCodec<number>({
  kind: "integer",
  zero: 0,
  isNative: isSafeInteger,
  assertBound: assertSafeInteger,
  validateBounds: validateDiscreteIntBounds,
  parseText: parseSafeIntString,
  formatText: formatSafeInt,
  issues: {
    type: builtinIssues.typeInteger,
    format: builtinIssues.formatIntegerString,
    bound: (violation: OrderedViolation, limit: number) => boundIssues[violation](limit),
  },
});

/** 安全整数双向编解码器（Number.isSafeInteger），支持链式区间与 .fromString() 字符串介质派生 */
export function int(): IntCodec {
  return defaultIntCodec;
}
