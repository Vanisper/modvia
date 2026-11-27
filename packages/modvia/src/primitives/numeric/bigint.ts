import { builtinIssues } from "../../codec/core/issues.ts";
import {
  validateDiscreteBigIntBounds,
  type OrderedViolation,
} from "../../scalars/bounds/ordered.ts";
import {
  assertBigIntValue,
  formatBigIntValue,
  isBigIntValue,
  parseBigIntString,
} from "../../scalars/numeric/bigint.ts";
import { createOrderedNumericCodec, type OrderedNumericCodec } from "./shared.ts";

/** 大整数双向编解码器，默认编码为 bigint，经 .fromString() 切换后编码为 string */
export type BigIntCodec<Encoded = bigint> = OrderedNumericCodec<bigint, Encoded>;

const boundIssues = {
  min: builtinIssues.bigintMin,
  max: builtinIssues.bigintMax,
  gt: builtinIssues.bigintGt,
  lt: builtinIssues.bigintLt,
} as const;

const defaultBigIntCodec: BigIntCodec = createOrderedNumericCodec<bigint>({
  kind: "bigint",
  zero: 0n,
  isNative: isBigIntValue,
  assertBound: assertBigIntValue,
  validateBounds: validateDiscreteBigIntBounds,
  parseText: parseBigIntString,
  formatText: formatBigIntValue,
  issues: {
    type: builtinIssues.typeBigint,
    format: builtinIssues.formatBigintString,
    bound: (violation: OrderedViolation, limit: bigint) => boundIssues[violation](limit),
  },
});

/** 原生大整数双向编解码器（bigint），支持链式区间与 .fromString() 字符串介质派生 */
export function bigint(): BigIntCodec {
  return defaultBigIntCodec;
}
