import { deduplicateLiterals, formatLiteral, isPrimitiveLiteral } from "../../shared/value.ts";
import { createCodec } from "../core/runtime.ts";
import type { Codec, FieldLiteral } from "../core/types.ts";

export interface StringOptions {
  readonly trim?: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}

export interface NumberOptions {
  readonly min?: number;
  readonly max?: number;
}

/** 字符串双向编解码器，可选去除首尾空白并校验 UTF-16 长度范围与正则表达式 */
export function string(options: StringOptions = {}): Codec<string, string> {
  const rawMinLength = options.minLength;
  const rawMaxLength = options.maxLength;
  if (rawMinLength !== undefined && (!Number.isSafeInteger(rawMinLength) || rawMinLength < 0)) {
    throw new RangeError("minLength must be a non-negative safe integer");
  }
  if (rawMaxLength !== undefined && (!Number.isSafeInteger(rawMaxLength) || rawMaxLength < 0)) {
    throw new RangeError("maxLength must be a non-negative safe integer");
  }
  const minLength = rawMinLength ?? 0;
  if (rawMaxLength !== undefined && rawMaxLength < minLength) {
    throw new RangeError("maxLength must be greater than or equal to minLength");
  }

  let safePattern: RegExp | undefined;
  if (options.pattern !== undefined) {
    if (!(options.pattern instanceof RegExp)) {
      throw new TypeError("pattern must be a RegExp instance");
    }
    safePattern = new RegExp(options.pattern.source, options.pattern.flags.replace(/[gy]/g, ""));
  }

  const trim = Boolean(options.trim);

  return createCodec<string, string>(
    (input, _direction, collector) => {
      if (typeof input !== "string") {
        return collector.add("type.string", "Expected a string");
      }
      const value = trim ? input.trim() : input;
      if (value.length < minLength) {
        return collector.add("string.min_length", `Expected at least ${minLength} characters`);
      }
      if (rawMaxLength !== undefined && value.length > rawMaxLength) {
        return collector.add("string.max_length", `Expected at most ${rawMaxLength} characters`);
      }
      if (safePattern !== undefined && !safePattern.test(value)) {
        return collector.add("string.pattern", `String does not match pattern ${safePattern}`);
      }
      return value;
    },
    {
      descriptor: {
        kind: "string",
        trim,
        ...(rawMinLength !== undefined ? { minLength: rawMinLength } : {}),
        ...(rawMaxLength !== undefined ? { maxLength: rawMaxLength } : {}),
        ...(safePattern !== undefined ? { pattern: safePattern.source } : {}),
      },
    },
  );
}

/** 有限数字双向编解码器，拒绝 NaN 与正负无穷，可选限制闭区间 [min, max] */
export function number(options: NumberOptions = {}): Codec<number, number> {
  const { min, max } = options;
  if (min !== undefined && (typeof min !== "number" || !Number.isFinite(min))) {
    throw new RangeError("min must be a finite number");
  }
  if (max !== undefined && (typeof max !== "number" || !Number.isFinite(max))) {
    throw new RangeError("max must be a finite number");
  }
  if (min !== undefined && max !== undefined && max < min) {
    throw new RangeError("max must be greater than or equal to min");
  }

  return createCodec<number, number>(
    (input, _direction, collector) => {
      if (typeof input !== "number" || !Number.isFinite(input)) {
        return collector.add("type.number", "Expected a finite number");
      }
      if (min !== undefined && input < min) {
        return collector.add("number.min", `Expected a number >= ${min}`);
      }
      if (max !== undefined && input > max) {
        return collector.add("number.max", `Expected a number <= ${max}`);
      }
      return input;
    },
    {
      descriptor: {
        kind: "number",
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      },
    },
  );
}

/** 安全整数双向编解码器（Number.isSafeInteger），可选限制整数闭区间 [min, max] */
export function int(options: NumberOptions = {}): Codec<number, number> {
  const { min, max } = options;
  if (min !== undefined && (typeof min !== "number" || !Number.isSafeInteger(min))) {
    throw new RangeError("min must be a safe integer");
  }
  if (max !== undefined && (typeof max !== "number" || !Number.isSafeInteger(max))) {
    throw new RangeError("max must be a safe integer");
  }
  if (min !== undefined && max !== undefined && max < min) {
    throw new RangeError("max must be greater than or equal to min");
  }

  return createCodec<number, number>(
    (input, _direction, collector) => {
      if (typeof input !== "number" || !Number.isSafeInteger(input)) {
        return collector.add("type.integer", "Expected a safe integer");
      }
      if (min !== undefined && input < min) {
        return collector.add("number.min", `Expected an integer >= ${min}`);
      }
      if (max !== undefined && input > max) {
        return collector.add("number.max", `Expected an integer <= ${max}`);
      }
      return input;
    },
    {
      descriptor: {
        kind: "integer",
        ...(min !== undefined ? { min } : {}),
        ...(max !== undefined ? { max } : {}),
      },
    },
  );
}

/** 布尔值双向编解码器 */
export function boolean(): Codec<boolean, boolean> {
  return createCodec<boolean, boolean>(
    (input, _direction, collector) => {
      if (typeof input !== "boolean") {
        return collector.add("type.boolean", "Expected a boolean");
      }
      return input;
    },
    { descriptor: { kind: "boolean" } },
  );
}

/** 零开销原样透传编解码器，用于在模型或字典中显式声明任意动态载荷字段 */
export function unknown(): Codec<unknown, unknown> {
  return createCodec<unknown, unknown>((input) => input, {
    descriptor: { kind: "unknown" },
  });
}

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
  const isAllowed = (value: string): value is Values[number] => valueSet.has(value);

  return createCodec<Values[number], Values[number]>(
    (input, _direction, collector) => {
      if (typeof input !== "string" || !isAllowed(input)) {
        return collector.add("string.one_of", expectedMessage);
      }
      return input;
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

  return createCodec<Values[number], Values[number]>(
    (input, _direction, collector) => {
      for (const candidate of uniqueValues) {
        if (Object.is(input, candidate)) return candidate as Values[number];
      }
      return collector.add("value.literal", expectedMessage);
    },
    {
      allowedLiterals: uniqueValues,
      descriptor: { kind: "literal", values: uniqueValues },
    },
  );
}
