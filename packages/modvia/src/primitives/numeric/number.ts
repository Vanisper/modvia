import { validateContinuousBounds } from "../../scalars/bounds/ordered.ts";
import {
  assertFiniteNumber,
  formatFiniteNumber,
  isFiniteNumber,
  parseFiniteNumberString,
} from "../../scalars/numeric/number.ts";
import {
  buildNumericJsonBounds,
  createOrderedScalarCodec,
  type OrderedNumericCodec,
} from "./shared.ts";

/** 有限浮点数双向编解码器，默认编码为 number，经 .fromString() 切换后编码为 string */
export type NumberCodec<Encoded = number> = OrderedNumericCodec<number, Encoded>;

const defaultNumberCodec: NumberCodec<number> = createOrderedScalarCodec<
  number,
  NumberCodec<number>
>({
  zero: 0,
  noun: "a number",
  errorDomain: "number",
  nativeTypeCode: "type.number",
  nativeTypeMessage: "Expected a finite number",
  stringFormatCode: "format.number_string",
  stringFormatMessage: "Expected a finite numeric string",
  stringWireFormat: "number-string",
  stringEncodedSchema: { type: "string" },
  isNative: isFiniteNumber,
  assertBound: assertFiniteNumber,
  validateBounds: validateContinuousBounds,
  parseFromString: parseFiniteNumberString,
  formatToString: formatFiniteNumber,
  buildNativeDescriptor(bounds, description) {
    const { lower, upper } = bounds;
    return {
      kind: "number",
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
  buildDecodedJsonSchema: (bounds) => buildNumericJsonBounds("number", bounds),
});

/** 有限浮点数双向编解码器，拒绝 NaN 与正负无穷，支持链式区间与 .fromString() 字符串介质派生 */
export function number(): NumberCodec<number> {
  return defaultNumberCodec;
}
