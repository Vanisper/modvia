import { deduplicateLiterals, formatLiteral, isPrimitiveLiteral } from "../../shared/value.ts";
import { createCodec, createStatefulCodec } from "../core/runtime.ts";
import type { Codec, FieldLiteral } from "../core/types.ts";

/** 字符串双向编解码器，支持对称裁剪、长度约束与无状态正则链式派生 */
export interface StringCodec extends Codec<string, string> {
  /** 对称去除首尾空白（幂等规范化，始终在长度与正则守卫之前执行） */
  trim(this: void): StringCodec;
  /** 限制最小 UTF-16 码元长度（非负安全整数） */
  minLength(this: void, min: number): StringCodec;
  /** 限制最大 UTF-16 码元长度（非负安全整数） */
  maxLength(this: void, max: number): StringCodec;
  /** 限制精确固定 UTF-16 码元长度（等价于同时设定相同 minLength 与 maxLength） */
  length(this: void, exact: number): StringCodec;
  /** 要求非空字符串（等价于 .minLength(1)） */
  nonEmpty(this: void): StringCodec;
  /** 限制字符串必须匹配给定正则表达式（自动剥离有状态的 g/y 标志） */
  pattern(this: void, regex: RegExp): StringCodec;
  /** 为当前字符串编解码器附加静态文档说明文本，保留全部字符串自有方法 */
  describe(this: void, description: string): StringCodec;
}

/** 有限浮点数双向编解码器，支持闭区间、开区间与正负号约束链式派生 */
export interface NumberCodec extends Codec<number, number> {
  /** 限制闭区间最小下界（value >= min） */
  min(this: void, min: number): NumberCodec;
  /** 限制闭区间最大上界（value <= max） */
  max(this: void, max: number): NumberCodec;
  /** 限制开区间严格下界（value > bound） */
  gt(this: void, bound: number): NumberCodec;
  /** 限制开区间严格上界（value < bound） */
  lt(this: void, bound: number): NumberCodec;
  /** 要求严格正数（value > 0，等价于 .gt(0)） */
  positive(this: void): NumberCodec;
  /** 要求非负数（value >= 0，等价于 .min(0)） */
  nonNegative(this: void): NumberCodec;
  /** 要求严格负数（value < 0，等价于 .lt(0)） */
  negative(this: void): NumberCodec;
  /** 要求非正数（value <= 0，等价于 .max(0)） */
  nonPositive(this: void): NumberCodec;
  /** 为当前数值编解码器附加静态文档说明文本，保留全部数值自有方法 */
  describe(this: void, description: string): NumberCodec;
}

/** 安全整数双向编解码器（Number.isSafeInteger），支持整数区间与正负号约束链式派生 */
export interface IntCodec extends Codec<number, number> {
  /** 限制整数闭区间最小下界（value >= min） */
  min(this: void, min: number): IntCodec;
  /** 限制整数闭区间最大上界（value <= max） */
  max(this: void, max: number): IntCodec;
  /** 限制整数严格下界（value > bound） */
  gt(this: void, bound: number): IntCodec;
  /** 限制整数严格上界（value < bound） */
  lt(this: void, bound: number): IntCodec;
  /** 要求正整数（value > 0，等价于 .gt(0)） */
  positive(this: void): IntCodec;
  /** 要求非负整数（value >= 0，等价于 .min(0)） */
  nonNegative(this: void): IntCodec;
  /** 要求负整数（value < 0，等价于 .lt(0)） */
  negative(this: void): IntCodec;
  /** 要求非正整数（value <= 0，等价于 .max(0)） */
  nonPositive(this: void): IntCodec;
  /** 为当前整数编解码器附加静态文档说明文本，保留全部整数自有方法 */
  describe(this: void, description: string): IntCodec;
}

interface StringState {
  readonly trim: boolean;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: RegExp;
}

interface NumericBound {
  readonly value: number;
  readonly exclusive: boolean;
}

interface NumericState {
  readonly lower?: NumericBound;
  readonly upper?: NumericBound;
}

function assertNonNegativeSafeInt(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

function sanitizePattern(pattern: RegExp): RegExp {
  if (!(pattern instanceof RegExp)) {
    throw new TypeError("pattern must be a RegExp instance");
  }
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
}

const defaultStringCodec: StringCodec = createStatefulCodec({
  state: { trim: false } as StringState,
  validate(state) {
    if (state.minLength !== undefined) assertNonNegativeSafeInt(state.minLength, "minLength");
    if (state.maxLength !== undefined) assertNonNegativeSafeInt(state.maxLength, "maxLength");
    if (
      state.minLength !== undefined &&
      state.maxLength !== undefined &&
      state.maxLength < state.minLength
    ) {
      throw new RangeError("maxLength must be greater than or equal to minLength");
    }
  },
  createRunner(state) {
    const { trim, minLength, maxLength, pattern } = state;
    return (input, _direction, collector) => {
      if (typeof input !== "string") {
        return collector.add("type.string", "Expected a string");
      }
      const value = trim ? input.trim() : input;
      if (minLength !== undefined && value.length < minLength) {
        return collector.add("string.min_length", `Expected at least ${minLength} characters`);
      }
      if (maxLength !== undefined && value.length > maxLength) {
        return collector.add("string.max_length", `Expected at most ${maxLength} characters`);
      }
      if (pattern !== undefined && !pattern.test(value)) {
        return collector.add("string.pattern", `String does not match pattern ${pattern}`);
      }
      return value;
    };
  },
  createDescriptor(state, description) {
    return {
      kind: "string",
      trim: state.trim,
      ...(state.minLength !== undefined ? { minLength: state.minLength } : {}),
      ...(state.maxLength !== undefined ? { maxLength: state.maxLength } : {}),
      ...(state.pattern !== undefined ? { pattern: state.pattern.source } : {}),
      ...(description !== undefined ? { description } : {}),
    };
  },
  methods: {
    trim: (state): StringState => ({ ...state, trim: true }),
    minLength: (state, min: number): StringState => {
      assertNonNegativeSafeInt(min, "minLength");
      return { ...state, minLength: min };
    },
    maxLength: (state, max: number): StringState => {
      assertNonNegativeSafeInt(max, "maxLength");
      return { ...state, maxLength: max };
    },
    length: (state, exact: number): StringState => {
      assertNonNegativeSafeInt(exact, "length");
      return { ...state, minLength: exact, maxLength: exact };
    },
    nonEmpty: (state): StringState => ({ ...state, minLength: 1 }),
    pattern: (state, regex: RegExp): StringState => ({
      ...state,
      pattern: sanitizePattern(regex),
    }),
  },
});

function assertFiniteNumber(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
}

function assertSafeInteger(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

const defaultNumberCodec: NumberCodec = createStatefulCodec({
  state: {} as NumericState,
  validate(state) {
    const { lower, upper } = state;
    if (lower !== undefined) assertFiniteNumber(lower.value, "lower bound");
    if (upper !== undefined) assertFiniteNumber(upper.value, "upper bound");
    if (lower !== undefined && upper !== undefined) {
      if (upper.value < lower.value) {
        throw new RangeError("Upper bound must be greater than or equal to lower bound");
      }
      if (upper.value === lower.value && (lower.exclusive || upper.exclusive)) {
        throw new RangeError("Empty numeric interval: exclusive bound cannot equal opposite bound");
      }
    }
  },
  createRunner(state) {
    const { lower, upper } = state;
    return (input, _direction, collector) => {
      if (typeof input !== "number" || !Number.isFinite(input)) {
        return collector.add("type.number", "Expected a finite number");
      }
      if (lower !== undefined) {
        if (lower.exclusive) {
          if (!(input > lower.value)) {
            return collector.add("number.gt", `Expected a number > ${lower.value}`);
          }
        } else if (input < lower.value) {
          return collector.add("number.min", `Expected a number >= ${lower.value}`);
        }
      }
      if (upper !== undefined) {
        if (upper.exclusive) {
          if (!(input < upper.value)) {
            return collector.add("number.lt", `Expected a number < ${upper.value}`);
          }
        } else if (input > upper.value) {
          return collector.add("number.max", `Expected a number <= ${upper.value}`);
        }
      }
      return input;
    };
  },
  createDescriptor(state, description) {
    const { lower, upper } = state;
    return {
      kind: "number",
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
  methods: {
    min: (state, min: number): NumericState => {
      assertFiniteNumber(min, "min");
      return { ...state, lower: { value: min, exclusive: false } };
    },
    max: (state, max: number): NumericState => {
      assertFiniteNumber(max, "max");
      return { ...state, upper: { value: max, exclusive: false } };
    },
    gt: (state, bound: number): NumericState => {
      assertFiniteNumber(bound, "gt");
      return { ...state, lower: { value: bound, exclusive: true } };
    },
    lt: (state, bound: number): NumericState => {
      assertFiniteNumber(bound, "lt");
      return { ...state, upper: { value: bound, exclusive: true } };
    },
    positive: (state): NumericState => ({ ...state, lower: { value: 0, exclusive: true } }),
    nonNegative: (state): NumericState => ({ ...state, lower: { value: 0, exclusive: false } }),
    negative: (state): NumericState => ({ ...state, upper: { value: 0, exclusive: true } }),
    nonPositive: (state): NumericState => ({ ...state, upper: { value: 0, exclusive: false } }),
  },
});

const defaultIntCodec: IntCodec = createStatefulCodec({
  state: {} as NumericState,
  validate(state) {
    const { lower, upper } = state;
    if (lower !== undefined) {
      assertSafeInteger(lower.value, "lower bound");
      if (lower.exclusive && lower.value === Number.MAX_SAFE_INTEGER) {
        throw new RangeError("No safe integer is greater than MAX_SAFE_INTEGER");
      }
    }
    if (upper !== undefined) {
      assertSafeInteger(upper.value, "upper bound");
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
  createRunner(state) {
    const { lower, upper } = state;
    return (input, _direction, collector) => {
      if (typeof input !== "number" || !Number.isSafeInteger(input)) {
        return collector.add("type.integer", "Expected a safe integer");
      }
      if (lower !== undefined) {
        if (lower.exclusive) {
          if (!(input > lower.value)) {
            return collector.add("number.gt", `Expected an integer > ${lower.value}`);
          }
        } else if (input < lower.value) {
          return collector.add("number.min", `Expected an integer >= ${lower.value}`);
        }
      }
      if (upper !== undefined) {
        if (upper.exclusive) {
          if (!(input < upper.value)) {
            return collector.add("number.lt", `Expected an integer < ${upper.value}`);
          }
        } else if (input > upper.value) {
          return collector.add("number.max", `Expected an integer <= ${upper.value}`);
        }
      }
      return input;
    };
  },
  createDescriptor(state, description) {
    const { lower, upper } = state;
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
  methods: {
    min: (state, min: number): NumericState => {
      assertSafeInteger(min, "min");
      return { ...state, lower: { value: min, exclusive: false } };
    },
    max: (state, max: number): NumericState => {
      assertSafeInteger(max, "max");
      return { ...state, upper: { value: max, exclusive: false } };
    },
    gt: (state, bound: number): NumericState => {
      assertSafeInteger(bound, "gt");
      return { ...state, lower: { value: bound, exclusive: true } };
    },
    lt: (state, bound: number): NumericState => {
      assertSafeInteger(bound, "lt");
      return { ...state, upper: { value: bound, exclusive: true } };
    },
    positive: (state): NumericState => ({ ...state, lower: { value: 0, exclusive: true } }),
    nonNegative: (state): NumericState => ({ ...state, lower: { value: 0, exclusive: false } }),
    negative: (state): NumericState => ({ ...state, upper: { value: 0, exclusive: true } }),
    nonPositive: (state): NumericState => ({ ...state, upper: { value: 0, exclusive: false } }),
  },
});

const defaultBooleanCodec: Codec<boolean, boolean> = createCodec<boolean, boolean>(
  (input, _direction, collector) => {
    if (typeof input !== "boolean") {
      return collector.add("type.boolean", "Expected a boolean");
    }
    return input;
  },
  { descriptor: { kind: "boolean" } },
);

const defaultUnknownCodec: Codec<unknown, unknown> = createCodec<unknown, unknown>(
  (input) => input,
  { descriptor: { kind: "unknown" } },
);

/** 字符串双向编解码器，可通过 .trim()、.minLength()、.maxLength()、.nonEmpty()、.pattern() 链式派生 */
export function string(): StringCodec {
  return defaultStringCodec;
}

/** 有限浮点数双向编解码器，拒绝 NaN 与正负无穷，可通过 .min()、.max()、.gt()、.lt()、.positive() 等链式派生 */
export function number(): NumberCodec {
  return defaultNumberCodec;
}

/** 安全整数双向编解码器（Number.isSafeInteger），可通过 .min()、.max()、.gt()、.lt()、.positive() 等链式派生 */
export function int(): IntCodec {
  return defaultIntCodec;
}

/** 布尔值双向编解码器 */
export function boolean(): Codec<boolean, boolean> {
  return defaultBooleanCodec;
}

/** 零开销原样透传编解码器，用于在模型或字典中显式声明任意动态载荷字段 */
export function unknown(): Codec<unknown, unknown> {
  return defaultUnknownCodec;
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
