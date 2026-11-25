import { builtinIssues } from "../../codec/core/issues.ts";
import { validateContinuousBounds, type OrderedViolation } from "../../scalars/bounds/ordered.ts";
import {
  assertFiniteNumber,
  formatFiniteNumber,
  isFiniteNumber,
  parseFiniteNumberString,
} from "../../scalars/numeric/number.ts";
import { createOrderedNumericCodec, type OrderedNumericCodec } from "./shared.ts";

/** 有限浮点数双向编解码器，默认编码为 number，经 .fromString() 切换后编码为 string */
export type NumberCodec<Encoded = number> = OrderedNumericCodec<number, Encoded>;

const boundIssues = {
  min: builtinIssues.numberMin,
  max: builtinIssues.numberMax,
  gt: builtinIssues.numberGt,
  lt: builtinIssues.numberLt,
} as const;

const defaultNumberCodec: NumberCodec = createOrderedNumericCodec<number>({
  kind: "number",
  zero: 0,
  isNative: isFiniteNumber,
  assertBound: assertFiniteNumber,
  validateBounds: validateContinuousBounds,
  parseText: parseFiniteNumberString,
  formatText: formatFiniteNumber,
  issues: {
    type: builtinIssues.typeNumber,
    format: builtinIssues.formatNumberString,
    bound: (violation: OrderedViolation, limit: number) => boundIssues[violation](limit),
  },
});

/** 有限浮点数双向编解码器，拒绝 NaN 与正负无穷，支持链式区间与 .fromString() 字符串介质派生 */
export function number(): NumberCodec {
  return defaultNumberCodec;
}
