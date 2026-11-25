import { validateDiscreteBigIntBounds } from "../../scalars/bounds/ordered.ts";
import {
  assertBigIntValue,
  formatBigIntValue,
  isBigIntValue,
  parseBigIntString,
} from "../../scalars/numeric/bigint.ts";
import { createOrderedNumericCodec, type OrderedNumericCodec } from "./shared.ts";

/** 大整数双向编解码器，默认编码为 bigint，经 .fromString() 切换后编码为 string */
export type BigIntCodec<Encoded = bigint> = OrderedNumericCodec<bigint, Encoded>;

const defaultBigIntCodec: BigIntCodec = createOrderedNumericCodec<bigint>({
  kind: "bigint",
  zero: 0n,
  noun: "a bigint",
  constraintDomain: "bigint",
  typeCode: "type.bigint",
  typeMessage: "Expected a bigint",
  isNative: isBigIntValue,
  assertBound: assertBigIntValue,
  validateBounds: validateDiscreteBigIntBounds,
  text: {
    format: "bigint-string",
    issueCode: "format.bigint_string",
    issueMessage: "Expected a base-10 bigint string",
    encodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
    parse: parseBigIntString,
    stringify: formatBigIntValue,
  },
});

/** 原生大整数双向编解码器（bigint），支持链式区间与 .fromString() 字符串介质派生 */
export function bigint(): BigIntCodec {
  return defaultBigIntCodec;
}
