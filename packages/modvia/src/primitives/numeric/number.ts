import type { TraitCodecBase, WithCodecTrait } from "../../codec/core/types.ts";
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
  type OrderedNumericTrait,
} from "./shared.ts";

/** 原生有限浮点数双向编解码器，支持区间派生与 .fromString() 字符串介质切换 */
export interface NativeNumberCodec extends TraitCodecBase<
  number,
  number,
  OrderedNumericTrait<number>
> {
  /** 切换外部编码表示为有限数值字符串（string ↔ number），保留全部已声明区间约束 */
  fromString(this: void): NumberCodec<string>;
  /** 为当前实例附加静态文档说明文本，同时完整保留区间与字符串切换方法 */
  describe(this: void, description: string): NativeNumberCodec;
  /** 限制闭区间最小下界（value >= min） */
  min(this: void, min: number): NativeNumberCodec;
  /** 限制闭区间最大上界（value <= max） */
  max(this: void, max: number): NativeNumberCodec;
  /** 限制开区间严格下界（value > bound） */
  gt(this: void, bound: number): NativeNumberCodec;
  /** 限制开区间严格上界（value < bound） */
  lt(this: void, bound: number): NativeNumberCodec;
  /** 要求严格正数（value > 0） */
  positive(this: void): NativeNumberCodec;
  /** 要求非负数（value >= 0） */
  nonNegative(this: void): NativeNumberCodec;
  /** 要求严格负数（value < 0） */
  negative(this: void): NativeNumberCodec;
  /** 要求非正数（value <= 0） */
  nonPositive(this: void): NativeNumberCodec;
}

/** 有限浮点数双向编解码器，默认编码为 number，经 .fromString() 切换后编码为 string */
export type NumberCodec<Encoded = number> = [Encoded] extends [number]
  ? NativeNumberCodec
  : WithCodecTrait<number, Encoded, OrderedNumericTrait<number>>;

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
