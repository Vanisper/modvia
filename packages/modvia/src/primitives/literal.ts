import { defineCodec } from "../codec/core/define.ts";
import { builtinIssues } from "../codec/core/issues.ts";
import type { Codec, CodecContext, Failed, FieldLiteral } from "../codec/core/types.ts";
import { deduplicateLiterals, isPrimitiveLiteral } from "../shared/value.ts";

/** 精确匹配一个或多个原始字面量（按 Object.is 比较；纯字符串字面量集在 Schema 导出时自动映射为 enum） */
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
  const mismatch = builtinIssues.literalNoMatch(values);
  const match = (input: unknown, context: CodecContext): Values[number] | Failed => {
    for (const candidate of values) {
      if (Object.is(input, candidate)) return candidate as Values[number];
    }
    return context.issue(mismatch);
  };

  return defineCodec<Values[number], Values[number]>({
    decode: match,
    encode: match,
    descriptor: { kind: "literal", values },
  });
}
