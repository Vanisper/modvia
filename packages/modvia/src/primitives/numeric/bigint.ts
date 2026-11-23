import { validateDiscreteBigIntBounds } from "../../scalars/bounds/ordered.ts";
import {
  assertBigIntValue,
  formatBigIntValue,
  isBigIntValue,
  parseBigIntString,
} from "../../scalars/numeric/bigint.ts";
import { createOrderedScalarCodec, type OrderedNumericCodec } from "./shared.ts";

/** 大整数双向编解码器，默认编码为 bigint，经 .fromString() 切换后编码为 string */
export type BigIntCodec<Encoded = bigint> = OrderedNumericCodec<bigint, Encoded>;

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
