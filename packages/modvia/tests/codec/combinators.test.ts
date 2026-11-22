import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  defineCodec,
  invert,
  isoDateTime,
  lazy,
  literal,
  number,
  pipe,
  string,
  unionOf,
  type Codec,
  type InferEncoded,
  type InferValue,
} from "../../src/codec/index.ts";
import { defineModel, type Model } from "../../src/index.ts";

const intFromString = defineCodec<number, string>({
  decode(input, context) {
    if (typeof input !== "string" || !/^-?\d+$/.test(input)) {
      return context.fail("number.integer_string", "Expected an integer string");
    }
    return Number(input);
  },
  encode(value, context) {
    if (!Number.isSafeInteger(value)) {
      return context.fail("number.safe_integer", "Expected a safe integer");
    }
    return String(value);
  },
});

describe("codec combinators", () => {
  test("check 在解码与编码两端按顺序执行对称业务约束", () => {
    const positiveEven = number()
      .check((value, context) => {
        if (value <= 0) context.fail("number.positive", "Expected a positive number");
      })
      .check((value, context) => {
        if (value % 2 !== 0) context.fail("number.even", "Expected an even number");
      });

    expect(positiveEven.decode(4)).toBe(4);
    expect(positiveEven.encode(4)).toBe(4);

    for (const [bad, code] of [
      [-2, "number.positive"],
      [3, "number.even"],
    ] as const) {
      expect(positiveEven.safeDecode(bad)).toMatchObject({ ok: false, issues: [{ code }] });
      expect(positiveEven.safeEncode(bad)).toMatchObject({ ok: false, issues: [{ code }] });
    }

    // 基础 Codec 先拦截非法类型，避免 check 回调收到非预期类型
    const afterEpoch = isoDateTime().check((date, context) => {
      if (date.getTime() < 0) context.fail("date.before_epoch", "Must be on or after 1970");
    });
    expect(afterEpoch.safeEncode(new Date(Number.NaN))).toMatchObject({
      ok: false,
      issues: [{ code: "type.datetime" }],
    });
    expect(afterEpoch.safeDecode("1969-12-31T23:59:59Z")).toMatchObject({
      ok: false,
      issues: [{ code: "date.before_epoch" }],
    });
    expect(afterEpoch.safeEncode(new Date(-1))).toMatchObject({
      ok: false,
      issues: [{ code: "date.before_epoch" }],
    });
  });

  test("check 支持通过 context.issue 非中断收集多条错误及相对子路径", () => {
    const Span = defineModel({
      fields: {
        min: number(),
        max: number(),
      },
    }).check((span, context) => {
      if (span.min < 0) {
        context.issue({ code: "span.negative_min", message: "min must be >= 0", path: ["min"] });
      }
      if (span.max < span.min) {
        context.issue({ code: "span.inverted", message: "max must be >= min", path: ["max"] });
      }
    });

    const failure = Span.safeDecode({ min: -5, max: -10 });
    expect(failure).toStrictEqual({
      ok: false,
      issues: [
        { path: ["min"], code: "span.negative_min", message: "min must be >= 0" },
        { path: ["max"], code: "span.inverted", message: "max must be >= min" },
      ],
    });
  });

  test("refine 支持布尔断言与 TypeScript 子类型收窄，强制要求稳定错误码", () => {
    const Positive = number().refine((n) => n > 0, "number.positive", "Expected > 0");
    expect(Positive.decode(3)).toBe(3);
    expect(Positive.safeDecode(0)).toMatchObject({
      ok: false,
      issues: [{ code: "number.positive", message: "Expected > 0" }],
    });
    expect(Positive.safeEncode(-1)).toMatchObject({
      ok: false,
      issues: [{ code: "number.positive" }],
    });

    const NonEmptyList = arrayOf(string()).refine(
      (items): items is [string, ...string[]] => items.length > 0,
      "array.non_empty",
      "At least one item required",
    );
    const decoded = NonEmptyList.decode(["first"]);
    expectTypeOf(decoded).toEqualTypeOf<[string, ...string[]]>();
    expectTypeOf<InferEncoded<typeof NonEmptyList>>().toEqualTypeOf<string[]>();
    expect(NonEmptyList.safeDecode([])).toMatchObject({
      ok: false,
      issues: [{ code: "array.non_empty" }],
    });

    expect(() => number().refine((n) => n > 0, "", "msg")).toThrow(TypeError);
  });

  test("normalize 在解码与编码两端维持幂等规范形态且满足往返收敛", () => {
    const Email = string({ trim: true })
      .normalize((value) => value.toLowerCase())
      .refine((value) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), "string.email", "Invalid email");

    const decoded = Email.decode("  Alice@Example.COM  ");
    expect(decoded).toBe("alice@example.com");
    expect(Email.encode("Alice@Example.COM")).toBe("alice@example.com");
    expect(Email.decode(Email.encode(decoded))).toBe(decoded);

    // 非法输入在进入 normalize 回调前已被基础 Codec 拦截
    expect(Email.safeDecode(123)).toMatchObject({
      ok: false,
      issues: [{ code: "type.string" }],
    });
    expect(Email.safeEncode(123 as unknown as string)).toMatchObject({
      ok: false,
      issues: [{ code: "type.string" }],
    });
  });

  test("check 与 or 混排遵循由内向外的包裹顺序", () => {
    const slugOrNull = string({ trim: true })
      .check((value, context) => {
        if (!/^[a-z0-9-]+$/.test(value)) {
          context.fail("string.slug", "Expected a lowercase slug");
        }
      })
      .nullable();

    expect(slugOrNull.decode("  hello-world  ")).toBe("hello-world");
    expect(slugOrNull.decode(null)).toBeNull();
    expect(slugOrNull.encode(null)).toBeNull();
    expect(slugOrNull.safeDecode("Bad Slug")).toMatchObject({
      ok: false,
      issues: [{ code: "string.slug" }],
    });
  });

  test("pipe 正向串联解码并逆向串联编码，支持方法链与顶层调用", () => {
    const trimmedPositiveInt = string({ trim: true })
      .pipe(intFromString)
      .check((value, context) => {
        if (value <= 0) context.fail("number.positive", "Expected > 0");
      });

    expect(trimmedPositiveInt.decode("  42  ")).toBe(42);
    expect(trimmedPositiveInt.encode(42)).toBe("42");
    expect(trimmedPositiveInt.safeDecode("  -5  ")).toMatchObject({
      ok: false,
      issues: [{ code: "number.positive" }],
    });
    expect(trimmedPositiveInt.safeEncode(-5)).toMatchObject({
      ok: false,
      issues: [{ code: "number.positive" }],
    });

    const topLevelPiped = pipe(string({ trim: true }), intFromString);
    expect(topLevelPiped.decode(" 7 ")).toBe(7);
    expect(topLevelPiped.encode(7)).toBe("7");

    expectTypeOf(trimmedPositiveInt).toEqualTypeOf<Codec<number, string>>();
    // @ts-expect-error pipe 不接受带属性修饰的 Field
    expect(() => string().pipe(intFromString.optional())).toThrow(TypeError);
  });

  test("invert 反转编解码方向并保持可逆性", () => {
    const utcStringFromDate = invert(isoDateTime());
    const date = new Date("2026-11-09T00:00:00.000Z");

    expect(utcStringFromDate.decode(date)).toBe("2026-11-09T00:00:00.000Z");
    expect(utcStringFromDate.encode("2026-11-09T02:00:00+02:00")).toEqual(date);
    expect(utcStringFromDate.safeDecode("not-a-date")).toMatchObject({
      ok: false,
      issues: [{ code: "type.datetime" }],
    });

    expectTypeOf<InferValue<typeof utcStringFromDate>>().toEqualTypeOf<string>();
    expectTypeOf<InferEncoded<typeof utcStringFromDate>>().toEqualTypeOf<Date>();
  });

  test("lazy 支持自引用递归模型而无需手写转发 Codec", () => {
    interface CategoryData {
      readonly id: string;
      readonly children: readonly CategoryData[];
    }
    interface CategoryDTO {
      id: string;
      children: CategoryDTO[];
    }

    const Category: Model<CategoryData, CategoryDTO> = defineModel({
      fields: {
        id: string({ trim: true, minLength: 1 }),
        children: arrayOf(lazy(() => Category)),
      },
    });

    const tree = Category.decode({
      id: " root ",
      children: [{ id: " child-1 ", children: [] }],
    });
    expect(tree).toStrictEqual({
      id: "root",
      children: [{ id: "child-1", children: [] }],
    });
    expect(Category.encode(tree)).toStrictEqual({
      id: "root",
      children: [{ id: "child-1", children: [] }],
    });
    expect(
      Category.safeDecode({
        id: "root",
        children: [{ id: " ", children: [] }],
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ path: ["children", 0, "id"], code: "string.min_length" }],
    });
  });

  test("literal 支持多类型精确字面量匹配", () => {
    const status = literal(200, 204, "pending", false, null);
    for (const item of [200, 204, "pending", false, null] as const) {
      expect(status.decode(item)).toBe(item);
      expect(status.encode(item)).toBe(item);
    }
    expect(status.safeDecode(500)).toMatchObject({
      ok: false,
      issues: [{ code: "value.literal" }],
    });
    expect(() => Reflect.apply(literal, undefined, [])).toThrow(RangeError);
    expect(() => Reflect.apply(literal, undefined, [{}])).toThrow(TypeError);

    expectTypeOf<InferValue<typeof status>>().toEqualTypeOf<200 | 204 | "pending" | false | null>();
  });

  test("unionOf 按从左到右顺序匹配分支并清理前序尝试的错误", () => {
    const timestampOrIso = unionOf(isoDateTime(), number());

    const date = new Date("2026-01-01T00:00:00.000Z");
    expect(timestampOrIso.decode("2026-01-01T00:00:00Z")).toEqual(date);
    expect(timestampOrIso.decode(1700000000)).toBe(1700000000);

    expect(timestampOrIso.encode(date)).toBe("2026-01-01T00:00:00.000Z");
    expect(timestampOrIso.encode(1700000000)).toBe(1700000000);

    expect(timestampOrIso.safeDecode(true)).toStrictEqual({
      ok: false,
      issues: [
        { path: [], code: "union.no_match", message: "Input did not match any union branch" },
      ],
    });

    // 重叠分支遵循从左到右首个命中优先
    const isoPreferred = unionOf(isoDateTime(), string());
    expect(isoPreferred.decode("2026-01-01T00:00:00Z")).toBeInstanceOf(Date);
    expect(isoPreferred.decode("plain-text")).toBe("plain-text");

    expect(() => Reflect.apply(unionOf, undefined, [string()])).toThrow(RangeError);
    expectTypeOf<InferValue<typeof timestampOrIso>>().toEqualTypeOf<Date | number>();
    expectTypeOf<InferEncoded<typeof timestampOrIso>>().toEqualTypeOf<string | number>();
  });
});
