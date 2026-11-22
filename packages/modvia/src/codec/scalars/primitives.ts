import { deduplicateLiterals, formatLiteral, isPrimitiveLiteral } from "../../shared/value.ts";
import { createCodec } from "../core/runtime.ts";
import type { Codec, FieldLiteral } from "../core/types.ts";

export interface StringOptions {
  readonly trim?: boolean;
  readonly minLength?: number;
}

/** 字符串双向编解码器，可选去除首尾空白并校验最小 UTF-16 长度 */
export function string(options: StringOptions = {}): Codec<string, string> {
  const minLength = options.minLength ?? 0;
  if (!Number.isInteger(minLength) || minLength < 0) {
    throw new RangeError("minLength must be a non-negative integer");
  }
  const trim = Boolean(options.trim);

  return createCodec<string, string>((input, _direction, collector) => {
    if (typeof input !== "string") {
      return collector.add("type.string", "Expected a string");
    }
    const value = trim ? input.trim() : input;
    if (value.length < minLength) {
      return collector.add("string.min_length", `Expected at least ${minLength} characters`);
    }
    return value;
  });
}

/** 有限数字双向编解码器，拒绝 NaN 与正负无穷 */
export function number(): Codec<number, number> {
  return createCodec<number, number>((input, _direction, collector) => {
    if (typeof input !== "number" || !Number.isFinite(input)) {
      return collector.add("type.number", "Expected a finite number");
    }
    return input;
  });
}

/** 安全整数双向编解码器（Number.isSafeInteger），拒绝浮点数与超出双精度安全整数范围的值 */
export function int(): Codec<number, number> {
  return createCodec<number, number>((input, _direction, collector) => {
    if (typeof input !== "number" || !Number.isSafeInteger(input)) {
      return collector.add("type.integer", "Expected a safe integer");
    }
    return input;
  });
}

/** 布尔值双向编解码器 */
export function boolean(): Codec<boolean, boolean> {
  return createCodec<boolean, boolean>((input, _direction, collector) => {
    if (typeof input !== "boolean") {
      return collector.add("type.boolean", "Expected a boolean");
    }
    return input;
  });
}

/** 零开销原样透传编解码器，用于在模型或字典中显式声明任意动态载荷字段 */
export function unknown(): Codec<unknown, unknown> {
  return createCodec<unknown, unknown>((input) => input);
}

/** 字符串字面量枚举双向编解码器 */
export function oneOf<const Values extends readonly string[]>(
  ...allowedValues: Values
): Codec<Values[number], Values[number]> {
  if (allowedValues.length === 0) {
    throw new RangeError("oneOf requires at least one value");
  }
  const values = new Set<string>(allowedValues);
  const expectedMessage = `Expected one of: ${[...values].join(", ")}`;
  const isAllowed = (value: string): value is Values[number] => values.has(value);

  return createCodec<Values[number], Values[number]>(
    (input, _direction, collector) => {
      if (typeof input !== "string" || !isAllowed(input)) {
        return collector.add("string.one_of", expectedMessage);
      }
      return input;
    },
    { allowedLiterals: [...values] },
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

  const uniqueValues = deduplicateLiterals([], allowedValues);
  const expectedMessage = `Expected literal: ${uniqueValues.map(formatLiteral).join(", ")}`;

  return createCodec<Values[number], Values[number]>(
    (input, _direction, collector) => {
      for (const candidate of uniqueValues) {
        if (Object.is(input, candidate)) return candidate as Values[number];
      }
      return collector.add("value.literal", expectedMessage);
    },
    { allowedLiterals: uniqueValues },
  );
}
