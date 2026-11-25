import { validateDiscreteIntBounds } from "../../scalars/bounds/ordered.ts";
import {
  assertSafeInteger,
  formatSafeInt,
  isSafeInteger,
  parseSafeIntString,
} from "../../scalars/numeric/int.ts";
import { createOrderedNumericCodec, type OrderedNumericCodec } from "./shared.ts";

/** 安全整数双向编解码器，默认编码为 number，经 .fromString() 切换后编码为 string */
export type IntCodec<Encoded = number> = OrderedNumericCodec<number, Encoded>;

const defaultIntCodec: IntCodec = createOrderedNumericCodec<number>({
  kind: "integer",
  zero: 0,
  noun: "an integer",
  constraintDomain: "number",
  typeCode: "type.integer",
  typeMessage: "Expected a safe integer",
  isNative: isSafeInteger,
  assertBound: assertSafeInteger,
  validateBounds: validateDiscreteIntBounds,
  text: {
    format: "int-string",
    issueCode: "format.int_string",
    issueMessage: "Expected a base-10 integer string",
    encodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
    parse: parseSafeIntString,
    stringify: formatSafeInt,
  },
});

/** 安全整数双向编解码器（Number.isSafeInteger），支持链式区间与 .fromString() 字符串介质派生 */
export function int(): IntCodec {
  return defaultIntCodec;
}
