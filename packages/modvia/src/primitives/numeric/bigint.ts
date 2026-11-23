import type { StatefulCodecBase, WithCodecTrait } from "../../codec/core/types.ts";
import { validateDiscreteBigIntBounds } from "../../scalars/bounds/ordered.ts";
import {
  assertBigIntValue,
  formatBigIntValue,
  isBigIntValue,
  parseBigIntString,
} from "../../scalars/numeric/bigint.ts";
import { createOrderedScalarCodec, type OrderedNumericTrait } from "./shared.ts";

/** 原生大整数双向编解码器（bigint），支持大整数区间派生与 .fromString() 十进制字符串介质切换 */
export interface NativeBigIntCodec extends StatefulCodecBase<
  bigint,
  bigint,
  OrderedNumericTrait<bigint>
> {
  /** 切换外部编码表示为十进制大整数字符串（string ↔ bigint），保留全部已声明区间约束 */
  fromString(this: void): BigIntCodec<string>;
  /** 为当前实例附加静态文档说明文本，同时完整保留区间与字符串切换方法 */
  describe(this: void, description: string): NativeBigIntCodec;
  /** 限制大整数闭区间最小下界（value >= min） */
  min(this: void, min: bigint): NativeBigIntCodec;
  /** 限制大整数闭区间最大上界（value <= max） */
  max(this: void, max: bigint): NativeBigIntCodec;
  /** 限制大整数严格下界（value > bound） */
  gt(this: void, bound: bigint): NativeBigIntCodec;
  /** 限制大整数严格上界（value < bound） */
  lt(this: void, bound: bigint): NativeBigIntCodec;
  /** 要求正大整数（value > 0n） */
  positive(this: void): NativeBigIntCodec;
  /** 要求非负大整数（value >= 0n） */
  nonNegative(this: void): NativeBigIntCodec;
  /** 要求负大整数（value < 0n） */
  negative(this: void): NativeBigIntCodec;
  /** 要求非正大整数（value <= 0n） */
  nonPositive(this: void): NativeBigIntCodec;
}

/** 大整数双向编解码器，默认编码为 bigint，经 .fromString() 切换后编码为 string */
export type BigIntCodec<Encoded = bigint> = [Encoded] extends [bigint]
  ? NativeBigIntCodec
  : WithCodecTrait<bigint, Encoded, OrderedNumericTrait<bigint>>;

const defaultBigIntCodec: BigIntCodec<bigint> = createOrderedScalarCodec<
  bigint,
  BigIntCodec<bigint>
>({
  zero: 0n,
  noun: "a bigint",
  errorDomain: "bigint",
  nativeTypeCode: "type.bigint",
  nativeTypeMessage: "Expected a bigint",
  stringFormatCode: "format.bigint_string",
  stringFormatMessage: "Expected a base-10 bigint string",
  stringWireFormat: "bigint-string",
  stringEncodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
  isNative: isBigIntValue,
  assertBound: assertBigIntValue,
  validateBounds: validateDiscreteBigIntBounds,
  parseFromString: parseBigIntString,
  formatToString: formatBigIntValue,
  buildNativeDescriptor(bounds, description) {
    const { lower, upper } = bounds;
    return {
      kind: "bigint",
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
});

/** 原生大整数双向编解码器（bigint），支持链式区间与 .fromString() 字符串介质派生 */
export function bigint(): BigIntCodec<bigint> {
  return defaultBigIntCodec;
}
