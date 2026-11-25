import { defineCodec } from "../codec/core/define.ts";
import type { Codec, CodecContext, FieldLiteral } from "../codec/core/types.ts";
import { deduplicateLiterals, formatLiteral, isPrimitiveLiteral } from "../shared/value.ts";

/** 字符串字面量枚举双向编解码器 */
export function oneOf<const Values extends readonly string[]>(
  ...allowedValues: Values
): Codec<Values[number], Values[number]> {
  if (allowedValues.length === 0) {
    throw new RangeError("oneOf requires at least one value");
  }
  const values = Object.freeze([...new Set<string>(allowedValues)]);
  const allowed = new Set(values);
  const expected = `Expected one of: ${values.join(", ")}`;
  const match = (input: unknown, context: CodecContext): Values[number] =>
    typeof input === "string" && allowed.has(input)
      ? (input as Values[number])
      : context.fail("string.one_of", expected);

  return defineCodec<Values[number], Values[number]>({
    decode: match,
    encode: match,
    descriptor: { kind: "enum", values },
  });
}

/** 精确匹配一个或多个原始字面量（按 Object.is 比较） */
export function literal<const Values extends readonly [FieldLiteral, ...FieldLiteral[]]>(
  ...allowedValues: Values
): Codec<Values[number], Values[number]> {
  if (allowedValues.length === 0) {
    throw new RangeError("literal requires at least one value");
  }
  if (!allowedValues.every(isPrimitiveLiteral)) {
    throw new TypeError("literal only accepts string, number, boolean, null, or undefined values");
  }
  const values = deduplicateLiterals([], allowedValues);
  const expected = `Expected literal: ${values.map(formatLiteral).join(", ")}`;
  const match = (input: unknown, context: CodecContext): Values[number] => {
    for (const candidate of values) {
      if (Object.is(input, candidate)) return candidate as Values[number];
    }
    return context.fail("value.literal", expected);
  };

  return defineCodec<Values[number], Values[number]>({
    decode: match,
    encode: match,
    descriptor: { kind: "literal", values },
  });
}
