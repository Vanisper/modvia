import { validateDiscreteIntBounds } from "../../scalars/bounds/ordered.ts";
import {
  assertSafeInteger,
  formatSafeInt,
  isSafeInteger,
  parseSafeIntString,
} from "../../scalars/numeric/int.ts";
import {
  buildNumericJsonBounds,
  createOrderedScalarCodec,
  type OrderedNumericCodec,
} from "./shared.ts";

/** 安全整数双向编解码器，默认编码为 number，经 .fromString() 切换后编码为 string */
export type IntCodec<Encoded = number> = OrderedNumericCodec<number, Encoded>;

const defaultIntCodec: IntCodec<number> = createOrderedScalarCodec<number, IntCodec<number>>({
  zero: 0,
  noun: "an integer",
  errorDomain: "number",
  nativeTypeCode: "type.integer",
  nativeTypeMessage: "Expected a safe integer",
  stringFormatCode: "format.int_string",
  stringFormatMessage: "Expected a base-10 integer string",
  stringWireFormat: "int-string",
  stringEncodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
  isNative: isSafeInteger,
  assertBound: assertSafeInteger,
  validateBounds: validateDiscreteIntBounds,
  parseFromString: parseSafeIntString,
  formatToString: formatSafeInt,
  buildNativeDescriptor(bounds, description) {
    const { lower, upper } = bounds;
    return {
      kind: "integer",
      ...(lower !== undefined
        ? lower.exclusive
          ? { exclusiveMin: lower.value }
          : { min: lower.value }
        : {}),
      ...(upper !== undefined
        ? upper.exclusive
          ? { exclusiveMax: upper.value }
          : { max: upper.value }
        : {}),
      ...(description !== undefined ? { description } : {}),
    };
  },
  buildDecodedJsonSchema: (bounds) => buildNumericJsonBounds("integer", bounds),
});

/** 安全整数双向编解码器（Number.isSafeInteger），支持链式区间与 .fromString() 字符串介质派生 */
export function int(): IntCodec<number> {
  return defaultIntCodec;
}
