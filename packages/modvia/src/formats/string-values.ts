import { defineCodec } from "../codec/core/define.ts";
import type { Codec } from "../codec/core/types.ts";
import type { NumberOptions } from "../codec/scalars/primitives.ts";

export interface BooleanFromStringOptions {
  readonly truthy?: readonly [string, ...string[]];
  readonly falsy?: readonly [string, ...string[]];
  readonly caseSensitive?: boolean;
}

const integerTextPattern = /^[+-]?\d+$/;
const numberTextPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

/**
 * 十进制整数文本与安全整数的双向编解码器（string ↔ number）
 *
 * @description 严格拒绝空白、空串、十六进制与非整数文本，编码归一输出十进制字符串（-0 归一为 "0"）
 */
export function intFromString(options: NumberOptions = {}): Codec<number, string> {
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

  return defineCodec<number, string>({
    decode(input, context) {
      if (typeof input !== "string") {
        return context.fail("type.string", "Expected a string");
      }
      if (!integerTextPattern.test(input)) {
        return context.fail("format.int_string", "Expected a base-10 integer string");
      }
      const parsed = Number(input);
      if (!Number.isSafeInteger(parsed)) {
        return context.fail("format.int_string", "Integer string exceeds safe integer range");
      }
      const normalized = Object.is(parsed, -0) ? 0 : parsed;
      if (min !== undefined && normalized < min) {
        return context.fail("number.min", `Expected an integer >= ${min}`);
      }
      if (max !== undefined && normalized > max) {
        return context.fail("number.max", `Expected an integer <= ${max}`);
      }
      return normalized;
    },
    encode(input, context) {
      if (typeof input !== "number" || !Number.isSafeInteger(input)) {
        return context.fail("type.integer", "Expected a safe integer");
      }
      if (min !== undefined && input < min) {
        return context.fail("number.min", `Expected an integer >= ${min}`);
      }
      if (max !== undefined && input > max) {
        return context.fail("number.max", `Expected an integer <= ${max}`);
      }
      return Object.is(input, -0) ? "0" : String(input);
    },
    meta: {
      format: "int-string",
      encodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
      decodedSchema: {
        type: "integer",
        ...(min !== undefined ? { minimum: min } : {}),
        ...(max !== undefined ? { maximum: max } : {}),
      },
    },
  });
}

/**
 * 有限数值文本与数字的双向编解码器（string ↔ number）
 *
 * @description 拒绝空串、首尾空白与 NaN/Infinity 文本，支持可选闭区间 [min, max]
 */
export function numberFromString(options: NumberOptions = {}): Codec<number, string> {
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

  return defineCodec<number, string>({
    decode(input, context) {
      if (typeof input !== "string") {
        return context.fail("type.string", "Expected a string");
      }
      if (!numberTextPattern.test(input)) {
        return context.fail("format.number_string", "Expected a finite numeric string");
      }
      const parsed = Number(input);
      if (!Number.isFinite(parsed)) {
        return context.fail("format.number_string", "Numeric string exceeds finite number range");
      }
      const normalized = Object.is(parsed, -0) ? 0 : parsed;
      if (min !== undefined && normalized < min) {
        return context.fail("number.min", `Expected a number >= ${min}`);
      }
      if (max !== undefined && normalized > max) {
        return context.fail("number.max", `Expected a number <= ${max}`);
      }
      return normalized;
    },
    encode(input, context) {
      if (typeof input !== "number" || !Number.isFinite(input)) {
        return context.fail("type.number", "Expected a finite number");
      }
      if (min !== undefined && input < min) {
        return context.fail("number.min", `Expected a number >= ${min}`);
      }
      if (max !== undefined && input > max) {
        return context.fail("number.max", `Expected a number <= ${max}`);
      }
      return Object.is(input, -0) ? "0" : String(input);
    },
    meta: {
      format: "number-string",
      encodedSchema: { type: "string" },
      decodedSchema: {
        type: "number",
        ...(min !== undefined ? { minimum: min } : {}),
        ...(max !== undefined ? { maximum: max } : {}),
      },
    },
  });
}

/**
 * 布尔文本与布尔值的双向编解码器（string ↔ boolean）
 *
 * @description 默认接受大小写不敏感的 "true" / "false"，编码统一收敛至各自首个规范词（默认 "true" / "false"）
 */
export function booleanFromString(options: BooleanFromStringOptions = {}): Codec<boolean, string> {
  const rawTruthy = options.truthy ?? ["true"];
  const rawFalsy = options.falsy ?? ["false"];
  const caseSensitive = Boolean(options.caseSensitive);

  if (rawTruthy.length === 0 || rawFalsy.length === 0) {
    throw new RangeError("truthy and falsy lists must each contain at least one string");
  }

  const normalizeToken = (token: string): string => {
    if (typeof token !== "string" || token.length === 0) {
      throw new TypeError("Boolean string tokens must be non-empty strings");
    }
    return caseSensitive ? token : token.toLowerCase();
  };

  const truthyTokens = rawTruthy.map(normalizeToken);
  const falsyTokens = rawFalsy.map(normalizeToken);
  const truthySet = new Set(truthyTokens);
  const falsySet = new Set(falsyTokens);

  for (const token of truthySet) {
    if (falsySet.has(token)) {
      throw new RangeError(`Overlapping boolean token "${token}" in truthy and falsy sets`);
    }
  }

  const canonicalTrue = rawTruthy[0] as string;
  const canonicalFalse = rawFalsy[0] as string;

  return defineCodec<boolean, string>({
    decode(input, context) {
      if (typeof input !== "string") {
        return context.fail("type.string", "Expected a string");
      }
      const key = caseSensitive ? input : input.toLowerCase();
      if (truthySet.has(key)) return true;
      if (falsySet.has(key)) return false;
      return context.fail("format.boolean_string", "Expected a valid boolean string");
    },
    encode(input, context) {
      if (typeof input !== "boolean") {
        return context.fail("type.boolean", "Expected a boolean");
      }
      return input ? canonicalTrue : canonicalFalse;
    },
    meta: {
      format: "boolean-string",
      encodedSchema: caseSensitive
        ? { type: "string", enum: [...truthySet, ...falsySet] }
        : { type: "string" },
      decodedSchema: { type: "boolean" },
    },
  });
}

/** 十进制大整数文本与 bigint 的双向编解码器（string ↔ bigint） */
export function bigintFromString(): Codec<bigint, string> {
  return defineCodec<bigint, string>({
    decode(input, context) {
      if (typeof input !== "string") {
        return context.fail("type.string", "Expected a string");
      }
      if (!integerTextPattern.test(input)) {
        return context.fail("format.bigint_string", "Expected a base-10 bigint string");
      }
      return BigInt(input);
    },
    encode(input, context) {
      if (typeof input !== "bigint") {
        return context.fail("type.bigint", "Expected a bigint");
      }
      return input.toString();
    },
    meta: {
      format: "bigint-string",
      encodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
    },
  });
}
