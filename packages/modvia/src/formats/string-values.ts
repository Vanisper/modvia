import { defineCodec } from "../codec/core/define.ts";
import type { Codec, CodecContext } from "../codec/core/types.ts";

/** 十进制整数文本与安全整数的双向编解码器（string ↔ number），支持整数区间与正负号链式派生 */
export interface IntFromStringCodec extends Codec<number, string> {
  /** 限制整数闭区间最小下界（value >= min） */
  min(this: void, min: number): IntFromStringCodec;
  /** 限制整数闭区间最大上界（value <= max） */
  max(this: void, max: number): IntFromStringCodec;
  /** 限制整数严格下界（value > bound） */
  gt(this: void, bound: number): IntFromStringCodec;
  /** 限制整数严格上界（value < bound） */
  lt(this: void, bound: number): IntFromStringCodec;
  /** 要求正整数（value > 0） */
  positive(this: void): IntFromStringCodec;
  /** 要求非负整数（value >= 0） */
  nonNegative(this: void): IntFromStringCodec;
  /** 要求负整数（value < 0） */
  negative(this: void): IntFromStringCodec;
  /** 要求非正整数（value <= 0） */
  nonPositive(this: void): IntFromStringCodec;
  /** 为当前整数文本编解码器附加静态文档说明文本，保留全部自有方法 */
  describe(this: void, description: string): IntFromStringCodec;
}

/** 有限数值文本与数字的双向编解码器（string ↔ number），支持闭区间、开区间与正负号链式派生 */
export interface NumberFromStringCodec extends Codec<number, string> {
  /** 限制闭区间最小下界（value >= min） */
  min(this: void, min: number): NumberFromStringCodec;
  /** 限制闭区间最大上界（value <= max） */
  max(this: void, max: number): NumberFromStringCodec;
  /** 限制开区间严格下界（value > bound） */
  gt(this: void, bound: number): NumberFromStringCodec;
  /** 限制开区间严格上界（value < bound） */
  lt(this: void, bound: number): NumberFromStringCodec;
  /** 要求严格正数（value > 0） */
  positive(this: void): NumberFromStringCodec;
  /** 要求非负数（value >= 0） */
  nonNegative(this: void): NumberFromStringCodec;
  /** 要求严格负数（value < 0） */
  negative(this: void): NumberFromStringCodec;
  /** 要求非正数（value <= 0） */
  nonPositive(this: void): NumberFromStringCodec;
  /** 为当前数值文本编解码器附加静态文档说明文本，保留全部自有方法 */
  describe(this: void, description: string): NumberFromStringCodec;
}

/** 布尔文本与布尔值的双向编解码器（string ↔ boolean），支持自定义真假词表与大小写敏感链式派生 */
export interface BooleanFromStringCodec extends Codec<boolean, string> {
  /** 自定义真值与假值候选词列表，编码端统一收敛至各自首个词 */
  tokens(
    this: void,
    truthy: readonly [string, ...string[]],
    falsy: readonly [string, ...string[]],
  ): BooleanFromStringCodec;
  /** 开启大小写精确敏感匹配（默认不区分大小写） */
  caseSensitive(this: void): BooleanFromStringCodec;
  /** 为当前布尔文本编解码器附加静态文档说明文本，保留全部自有方法 */
  describe(this: void, description: string): BooleanFromStringCodec;
}

/** 十进制大整数文本与 bigint 的双向编解码器（string ↔ bigint），支持大整数区间与正负号链式派生 */
export interface BigIntFromStringCodec extends Codec<bigint, string> {
  /** 限制大整数闭区间最小下界（value >= min） */
  min(this: void, min: bigint): BigIntFromStringCodec;
  /** 限制大整数闭区间最大上界（value <= max） */
  max(this: void, max: bigint): BigIntFromStringCodec;
  /** 限制大整数严格下界（value > bound） */
  gt(this: void, bound: bigint): BigIntFromStringCodec;
  /** 限制大整数严格上界（value < bound） */
  lt(this: void, bound: bigint): BigIntFromStringCodec;
  /** 要求正大整数（value > 0n） */
  positive(this: void): BigIntFromStringCodec;
  /** 要求非负大整数（value >= 0n） */
  nonNegative(this: void): BigIntFromStringCodec;
  /** 要求负大整数（value < 0n） */
  negative(this: void): BigIntFromStringCodec;
  /** 要求非正大整数（value <= 0n） */
  nonPositive(this: void): BigIntFromStringCodec;
  /** 为当前大整数文本编解码器附加静态文档说明文本，保留全部自有方法 */
  describe(this: void, description: string): BigIntFromStringCodec;
}

interface NumericBound<N> {
  readonly value: N;
  readonly exclusive: boolean;
}

interface NumericState<N> {
  readonly lower?: NumericBound<N>;
  readonly upper?: NumericBound<N>;
}

interface BooleanStringState {
  readonly rawTruthy: readonly [string, ...string[]];
  readonly rawFalsy: readonly [string, ...string[]];
  readonly caseSensitive: boolean;
  readonly truthySet: ReadonlySet<string>;
  readonly falsySet: ReadonlySet<string>;
}

const integerTextPattern = /^[+-]?\d+$/;
const numberTextPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

function assertFinite(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
}

function assertSafeInt(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

function assertBigInt(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be a bigint`);
  }
}

function checkNumberBounds(
  value: number,
  state: Readonly<NumericState<number>>,
  noun: string,
  context: CodecContext,
): void {
  const { lower, upper } = state;
  if (lower !== undefined) {
    if (lower.exclusive) {
      if (!(value > lower.value)) {
        context.fail("number.gt", `Expected ${noun} > ${lower.value}`);
      }
    } else if (value < lower.value) {
      context.fail("number.min", `Expected ${noun} >= ${lower.value}`);
    }
  }
  if (upper !== undefined) {
    if (upper.exclusive) {
      if (!(value < upper.value)) {
        context.fail("number.lt", `Expected ${noun} < ${upper.value}`);
      }
    } else if (value > upper.value) {
      context.fail("number.max", `Expected ${noun} <= ${upper.value}`);
    }
  }
}

function buildDecodedNumericSchema(
  type: "integer" | "number",
  state: Readonly<NumericState<number>>,
): Record<string, unknown> {
  const { lower, upper } = state;
  return {
    type,
    ...(lower !== undefined
      ? lower.exclusive
        ? { exclusiveMinimum: lower.value }
        : { minimum: lower.value }
      : {}),
    ...(upper !== undefined
      ? upper.exclusive
        ? { exclusiveMaximum: upper.value }
        : { maximum: upper.value }
      : {}),
  };
}

const defaultIntFromStringCodec: IntFromStringCodec = defineCodec({
  state: {} as NumericState<number>,
  validate(state) {
    const { lower, upper } = state;
    if (lower !== undefined) {
      assertSafeInt(lower.value, "lower bound");
      if (lower.exclusive && lower.value === Number.MAX_SAFE_INTEGER) {
        throw new RangeError("No safe integer is greater than MAX_SAFE_INTEGER");
      }
    }
    if (upper !== undefined) {
      assertSafeInt(upper.value, "upper bound");
      if (upper.exclusive && upper.value === Number.MIN_SAFE_INTEGER) {
        throw new RangeError("No safe integer is less than MIN_SAFE_INTEGER");
      }
    }
    if (lower !== undefined && upper !== undefined) {
      const effectiveMin = lower.exclusive ? lower.value + 1 : lower.value;
      const effectiveMax = upper.exclusive ? upper.value - 1 : upper.value;
      if (effectiveMax < effectiveMin) {
        throw new RangeError(
          "Empty integer interval: upper bound leaves no valid integer above lower bound",
        );
      }
    }
  },
  decode(input, context, state) {
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
    checkNumberBounds(normalized, state, "an integer", context);
    return normalized;
  },
  encode(input, context, state) {
    if (typeof input !== "number" || !Number.isSafeInteger(input)) {
      return context.fail("type.integer", "Expected a safe integer");
    }
    const normalized = Object.is(input, -0) ? 0 : input;
    checkNumberBounds(normalized, state, "an integer", context);
    return String(normalized);
  },
  meta: (state) => ({
    format: "int-string",
    encodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
    decodedSchema: buildDecodedNumericSchema("integer", state),
  }),
  methods: {
    min: (state, min: number): NumericState<number> => {
      assertSafeInt(min, "min");
      return { ...state, lower: { value: min, exclusive: false } };
    },
    max: (state, max: number): NumericState<number> => {
      assertSafeInt(max, "max");
      return { ...state, upper: { value: max, exclusive: false } };
    },
    gt: (state, bound: number): NumericState<number> => {
      assertSafeInt(bound, "gt");
      return { ...state, lower: { value: bound, exclusive: true } };
    },
    lt: (state, bound: number): NumericState<number> => {
      assertSafeInt(bound, "lt");
      return { ...state, upper: { value: bound, exclusive: true } };
    },
    positive: (state): NumericState<number> => ({
      ...state,
      lower: { value: 0, exclusive: true },
    }),
    nonNegative: (state): NumericState<number> => ({
      ...state,
      lower: { value: 0, exclusive: false },
    }),
    negative: (state): NumericState<number> => ({
      ...state,
      upper: { value: 0, exclusive: true },
    }),
    nonPositive: (state): NumericState<number> => ({
      ...state,
      upper: { value: 0, exclusive: false },
    }),
  },
});

const defaultNumberFromStringCodec: NumberFromStringCodec = defineCodec({
  state: {} as NumericState<number>,
  validate(state) {
    const { lower, upper } = state;
    if (lower !== undefined) assertFinite(lower.value, "lower bound");
    if (upper !== undefined) assertFinite(upper.value, "upper bound");
    if (lower !== undefined && upper !== undefined) {
      if (upper.value < lower.value) {
        throw new RangeError("Upper bound must be greater than or equal to lower bound");
      }
      if (upper.value === lower.value && (lower.exclusive || upper.exclusive)) {
        throw new RangeError("Empty numeric interval: exclusive bound cannot equal opposite bound");
      }
    }
  },
  decode(input, context, state) {
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
    checkNumberBounds(normalized, state, "a number", context);
    return normalized;
  },
  encode(input, context, state) {
    if (typeof input !== "number" || !Number.isFinite(input)) {
      return context.fail("type.number", "Expected a finite number");
    }
    const normalized = Object.is(input, -0) ? 0 : input;
    checkNumberBounds(normalized, state, "a number", context);
    return String(normalized);
  },
  meta: (state) => ({
    format: "number-string",
    encodedSchema: { type: "string" },
    decodedSchema: buildDecodedNumericSchema("number", state),
  }),
  methods: {
    min: (state, min: number): NumericState<number> => {
      assertFinite(min, "min");
      return { ...state, lower: { value: min, exclusive: false } };
    },
    max: (state, max: number): NumericState<number> => {
      assertFinite(max, "max");
      return { ...state, upper: { value: max, exclusive: false } };
    },
    gt: (state, bound: number): NumericState<number> => {
      assertFinite(bound, "gt");
      return { ...state, lower: { value: bound, exclusive: true } };
    },
    lt: (state, bound: number): NumericState<number> => {
      assertFinite(bound, "lt");
      return { ...state, upper: { value: bound, exclusive: true } };
    },
    positive: (state): NumericState<number> => ({
      ...state,
      lower: { value: 0, exclusive: true },
    }),
    nonNegative: (state): NumericState<number> => ({
      ...state,
      lower: { value: 0, exclusive: false },
    }),
    negative: (state): NumericState<number> => ({
      ...state,
      upper: { value: 0, exclusive: true },
    }),
    nonPositive: (state): NumericState<number> => ({
      ...state,
      upper: { value: 0, exclusive: false },
    }),
  },
});

function buildBooleanState(
  rawTruthy: readonly [string, ...string[]],
  rawFalsy: readonly [string, ...string[]],
  caseSensitive: boolean,
): BooleanStringState {
  if (!Array.isArray(rawTruthy) || rawTruthy.length === 0) {
    throw new RangeError("truthy list must contain at least one string");
  }
  if (!Array.isArray(rawFalsy) || rawFalsy.length === 0) {
    throw new RangeError("falsy list must contain at least one string");
  }
  const normalizeToken = (token: string): string => {
    if (typeof token !== "string" || token.length === 0) {
      throw new TypeError("Boolean string tokens must be non-empty strings");
    }
    return caseSensitive ? token : token.toLowerCase();
  };
  const truthySet = new Set(rawTruthy.map(normalizeToken));
  const falsySet = new Set(rawFalsy.map(normalizeToken));
  for (const token of truthySet) {
    if (falsySet.has(token)) {
      throw new RangeError(`Overlapping boolean token "${token}" in truthy and falsy sets`);
    }
  }
  return { rawTruthy, rawFalsy, caseSensitive, truthySet, falsySet };
}

const defaultBooleanFromStringCodec: BooleanFromStringCodec = defineCodec({
  state: buildBooleanState(["true"], ["false"], false),
  decode(input, context, state) {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    const key = state.caseSensitive ? input : input.toLowerCase();
    if (state.truthySet.has(key)) return true;
    if (state.falsySet.has(key)) return false;
    return context.fail("format.boolean_string", "Expected a valid boolean string");
  },
  encode(input, context, state) {
    if (typeof input !== "boolean") {
      return context.fail("type.boolean", "Expected a boolean");
    }
    return input ? state.rawTruthy[0] : state.rawFalsy[0];
  },
  meta: (state) => ({
    format: "boolean-string",
    encodedSchema: state.caseSensitive
      ? { type: "string", enum: [...state.truthySet, ...falsySetValues(state.falsySet)] }
      : { type: "string" },
    decodedSchema: { type: "boolean" },
  }),
  methods: {
    tokens: (
      state,
      truthy: readonly [string, ...string[]],
      falsy: readonly [string, ...string[]],
    ): BooleanStringState => buildBooleanState(truthy, falsy, state.caseSensitive),
    caseSensitive: (state): BooleanStringState =>
      buildBooleanState(state.rawTruthy, state.rawFalsy, true),
  },
});

function falsySetValues(set: ReadonlySet<string>): readonly string[] {
  return [...set];
}

function checkBigIntBounds(
  value: bigint,
  state: Readonly<NumericState<bigint>>,
  context: CodecContext,
): void {
  const { lower, upper } = state;
  if (lower !== undefined) {
    if (lower.exclusive) {
      if (!(value > lower.value)) {
        context.fail("bigint.gt", `Expected a bigint > ${lower.value}`);
      }
    } else if (value < lower.value) {
      context.fail("bigint.min", `Expected a bigint >= ${lower.value}`);
    }
  }
  if (upper !== undefined) {
    if (upper.exclusive) {
      if (!(value < upper.value)) {
        context.fail("bigint.lt", `Expected a bigint < ${upper.value}`);
      }
    } else if (value > upper.value) {
      context.fail("bigint.max", `Expected a bigint <= ${upper.value}`);
    }
  }
}

const defaultBigIntFromStringCodec: BigIntFromStringCodec = defineCodec({
  state: {} as NumericState<bigint>,
  validate(state) {
    const { lower, upper } = state;
    if (lower !== undefined) assertBigInt(lower.value, "lower bound");
    if (upper !== undefined) assertBigInt(upper.value, "upper bound");
    if (lower !== undefined && upper !== undefined) {
      const effectiveMin = lower.exclusive ? lower.value + 1n : lower.value;
      const effectiveMax = upper.exclusive ? upper.value - 1n : upper.value;
      if (effectiveMax < effectiveMin) {
        throw new RangeError(
          "Empty bigint interval: upper bound leaves no valid bigint above lower bound",
        );
      }
    }
  },
  decode(input, context, state) {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    if (!integerTextPattern.test(input)) {
      return context.fail("format.bigint_string", "Expected a base-10 bigint string");
    }
    const parsed = BigInt(input);
    checkBigIntBounds(parsed, state, context);
    return parsed;
  },
  encode(input, context, state) {
    if (typeof input !== "bigint") {
      return context.fail("type.bigint", "Expected a bigint");
    }
    checkBigIntBounds(input, state, context);
    return input.toString();
  },
  meta: {
    format: "bigint-string",
    encodedSchema: { type: "string", pattern: "^[+-]?\\d+$" },
  },
  methods: {
    min: (state, min: bigint): NumericState<bigint> => {
      assertBigInt(min, "min");
      return { ...state, lower: { value: min, exclusive: false } };
    },
    max: (state, max: bigint): NumericState<bigint> => {
      assertBigInt(max, "max");
      return { ...state, upper: { value: max, exclusive: false } };
    },
    gt: (state, bound: bigint): NumericState<bigint> => {
      assertBigInt(bound, "gt");
      return { ...state, lower: { value: bound, exclusive: true } };
    },
    lt: (state, bound: bigint): NumericState<bigint> => {
      assertBigInt(bound, "lt");
      return { ...state, upper: { value: bound, exclusive: true } };
    },
    positive: (state): NumericState<bigint> => ({
      ...state,
      lower: { value: 0n, exclusive: true },
    }),
    nonNegative: (state): NumericState<bigint> => ({
      ...state,
      lower: { value: 0n, exclusive: false },
    }),
    negative: (state): NumericState<bigint> => ({
      ...state,
      upper: { value: 0n, exclusive: true },
    }),
    nonPositive: (state): NumericState<bigint> => ({
      ...state,
      upper: { value: 0n, exclusive: false },
    }),
  },
});

/**
 * 十进制整数文本与安全整数的双向编解码器（string ↔ number）
 *
 * @description 严格拒绝空白、空串、十六进制与非整数文本，编码归一输出十进制字符串（-0 归一为 "0"）
 */
export function intFromString(): IntFromStringCodec {
  return defaultIntFromStringCodec;
}

/**
 * 有限数值文本与数字的双向编解码器（string ↔ number）
 *
 * @description 拒绝空串、首尾空白与 NaN/Infinity 文本，可通过 .min()、.max()、.gt()、.lt()、.positive() 等链式限制范围
 */
export function numberFromString(): NumberFromStringCodec {
  return defaultNumberFromStringCodec;
}

/**
 * 布尔文本与布尔值的双向编解码器（string ↔ boolean）
 *
 * @description 默认接受大小写不敏感的 "true" / "false"，可通过 .tokens(...) 与 .caseSensitive() 链式定制
 */
export function booleanFromString(): BooleanFromStringCodec {
  return defaultBooleanFromStringCodec;
}

/** 十进制大整数文本与 bigint 的双向编解码器（string ↔ bigint），支持区间与正负号链式派生 */
export function bigintFromString(): BigIntFromStringCodec {
  return defaultBigIntFromStringCodec;
}
