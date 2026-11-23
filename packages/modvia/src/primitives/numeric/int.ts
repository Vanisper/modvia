import type { StatefulCodecBase, WithCodecTrait } from "../../codec/core/types.ts";
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
  type OrderedNumericTrait,
} from "./shared.ts";

/** 原生安全整数双向编解码器（Number.isSafeInteger），支持区间派生与 .fromString() 字符串介质切换 */
export interface NativeIntCodec extends StatefulCodecBase<
  number,
  number,
  OrderedNumericTrait<number>
> {
  /** 切换外部编码表示为十进制整数字符串（string ↔ number），保留全部已声明区间约束 */
  fromString(this: void): IntCodec<string>;
  /** 为当前实例附加静态文档说明文本，同时完整保留区间与字符串切换方法 */
  describe(this: void, description: string): NativeIntCodec;
  /** 限制整数闭区间最小下界（value >= min） */
  min(this: void, min: number): NativeIntCodec;
  /** 限制整数闭区间最大上界（value <= max） */
  max(this: void, max: number): NativeIntCodec;
  /** 限制整数严格下界（value > bound） */
  gt(this: void, bound: number): NativeIntCodec;
  /** 限制整数严格上界（value < bound） */
  lt(this: void, bound: number): NativeIntCodec;
  /** 要求正整数（value > 0） */
  positive(this: void): NativeIntCodec;
  /** 要求非负整数（value >= 0） */
  nonNegative(this: void): NativeIntCodec;
  /** 要求负整数（value < 0） */
  negative(this: void): NativeIntCodec;
  /** 要求非正整数（value <= 0） */
  nonPositive(this: void): NativeIntCodec;
}

/** 安全整数双向编解码器，默认编码为 number，经 .fromString() 切换后编码为 string */
export type IntCodec<Encoded = number> = [Encoded] extends [number]
  ? NativeIntCodec
  : WithCodecTrait<number, Encoded, OrderedNumericTrait<number>>;

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
