import { createCodec, type InternalRunner } from "../codec/core/runtime.ts";
import type { Codec, FieldLiteral } from "../codec/core/types.ts";
import { deduplicateLiterals, formatLiteral, isPrimitiveLiteral } from "../shared/value.ts";

/** 字符串字面量枚举双向编解码器 */
export function oneOf<const Values extends readonly string[]>(
  ...allowedValues: Values
): Codec<Values[number], Values[number]> {
  if (allowedValues.length === 0) {
    throw new RangeError("oneOf requires at least one value");
  }
  const values = Object.freeze([...new Set<string>(allowedValues)]);
  const expectedMessage = `Expected one of: ${values.join(", ")}`;
  const valueSet = new Set<string>(values);

  return createCodec<Values[number], Values[number]>(
    (input, _direction, collector) => {
      if (typeof input !== "string" || !valueSet.has(input)) {
        return collector.add("string.one_of", expectedMessage);
      }
      return input as Values[number];
    },
    {
      allowedLiterals: values,
      descriptor: { kind: "enum", values },
    },
  );
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

  const uniqueValues = Object.freeze(deduplicateLiterals([], allowedValues));
  const expectedMessage = `Expected literal: ${uniqueValues.map(formatLiteral).join(", ")}`;

  let runner: InternalRunner<Values[number], Values[number]>;
  if (uniqueValues.length === 1) {
    const single = uniqueValues[0] as Values[number];
    if (typeof single === "number") {
      runner = (input, _direction, collector) =>
        Object.is(input, single) ? single : collector.add("value.literal", expectedMessage);
    } else {
      runner = (input, _direction, collector) =>
        input === single ? single : collector.add("value.literal", expectedMessage);
    }
  } else {
    const count = uniqueValues.length;
    runner = (input, _direction, collector) => {
      for (let i = 0; i < count; i++) {
        if (Object.is(input, uniqueValues[i])) {
          return uniqueValues[i] as Values[number];
        }
      }
      return collector.add("value.literal", expectedMessage);
    };
  }

  return createCodec<Values[number], Values[number]>(runner, {
    allowedLiterals: uniqueValues,
    descriptor: { kind: "literal", values: uniqueValues },
  });
}
