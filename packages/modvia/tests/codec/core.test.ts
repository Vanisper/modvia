import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  Codec,
  Field,
  int,
  isoDateTime,
  number,
  string,
  ValidationError,
  type ArrayCodec,
  type Branded,
  type CodecLike,
  type InferEncoded,
  type InferValue,
  type StandardSchemaV1,
} from "../../src/codec.ts";
import { literal, Model } from "../../src/index.ts";

const intFromString = Codec.define<number, string>({
  decode(input, context) {
    if (typeof input !== "string" || !/^-?\d+$/.test(input)) {
      return context.fail("number.integer_string", "Expected an integer string");
    }
    const parsed = Number(input);
    if (!Number.isSafeInteger(parsed)) {
      return context.fail("number.safe_integer", "Expected a safe integer");
    }
    return parsed;
  },
  encode(value, context) {
    if (typeof value !== "number" || !Number.isSafeInteger(value)) {
      return context.fail("number.safe_integer", "Expected a safe integer");
    }
    return String(value);
  },
});

describe("codec kernel", () => {
  test("2×2 执行矩阵：decode/encode 约束编译期契约，parse/dump 面向 unknown 动态边界", () => {
    const okDecoded = intFromString.safeDecode("42");
    expect(okDecoded).toStrictEqual({ ok: true, value: 42 });
    expect(Object.isFrozen(okDecoded)).toBe(true);

    const badDecoded = intFromString.safeDecode("abc");
    expect(badDecoded.ok).toBe(false);
    if (badDecoded.ok) throw new Error("Expected failure");
    expect(badDecoded.issues).toStrictEqual([
      { path: [], code: "number.integer_string", message: "Expected an integer string" },
    ]);
    expect(Object.isFrozen(badDecoded.issues)).toBe(true);
    expect(Object.isFrozen(badDecoded.issues[0]?.path)).toBe(true);

    expect(intFromString.safeEncode(42)).toStrictEqual({ ok: true, value: "42" });
    const badEncoded = intFromString.safeEncode(Number.NaN);
    expect(badEncoded).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "number.safe_integer" }],
    });

    // @ts-expect-error decode 编译期拒绝非 Encoded 类型
    expect(intFromString.safeDecode(42).ok).toBe(false);
    // @ts-expect-error encode 编译期拒绝非 T 类型
    expect(intFromString.safeEncode("42").ok).toBe(false);

    // parse / safeParse 与 dump / safeDump 接收任意 unknown 并在运行时安全校验
    const rawIn: unknown = "42";
    const rawOut: unknown = 42;
    expect(intFromString.parse(rawIn)).toBe(42);
    expect(intFromString.dump(rawOut)).toBe("42");
    expect(intFromString.safeParse(null)).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "number.integer_string" }],
    });
    expect(intFromString.safeDump(null)).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "number.safe_integer" }],
    });
    expect(() => intFromString.parse({})).toThrow(ValidationError);
    expect(() => intFromString.dump({})).toThrow(ValidationError);

    expectTypeOf<InferValue<typeof intFromString>>().toEqualTypeOf<number>();
    expectTypeOf<InferEncoded<typeof intFromString>>().toEqualTypeOf<string>();
  });

  test("ValidationError 支持跨上下文识别并格式化嵌套路径", () => {
    const matrix = arrayOf(arrayOf(intFromString));
    let caught: unknown;
    try {
      matrix.decode([["1"], ["bad"]]);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    expect(ValidationError.is(caught)).toBe(true);
    if (!ValidationError.is(caught)) throw new Error("Expected ValidationError");
    expect(caught.message).toBe("[1][0]: Expected an integer string");

    const foreignLike = runInNewContext(
      `({ [Symbol.for("modvia.ValidationError")]: true, issues: [] })`,
    );
    expect(ValidationError.is(foreignLike)).toBe(true);
    expect(ValidationError.is(new Error("plain"))).toBe(false);
    expect(ValidationError.is(null)).toBe(false);
  });

  test("自定义 Codec 中的非校验异常原样向外传播", () => {
    const boom = new Error("storage unavailable");
    const broken = Codec.define<string, string>({
      decode() {
        throw boom;
      },
      encode(value) {
        return String(value);
      },
    });

    expect(() => broken.safeDecode("x")).toThrow(boom);
    expect(() => broken.decode("x")).toThrow(boom);
  });

  test("or 支持多字面量、链式扁平化及 Object.is 精确哨兵匹配", () => {
    const stamp = "2026-01-01T00:00:00.000Z";
    const base = isoDateTime();
    const multi = base.or(stamp, 0, false).nullable().or(undefined);

    for (const literal of [stamp, 0, false, null, undefined] as const) {
      expect(multi.decode(literal)).toBe(literal);
      expect(multi.encode(literal)).toBe(literal);
    }

    const date = new Date(stamp);
    expect(base.decode(stamp)).toEqual(date);
    expect(multi.decode("2026-01-01T00:00:00Z")).toEqual(date);
    expect(multi.encode(date)).toBe(stamp);

    const numericSentinels = string().or(Number.NaN, -0);
    expect(numericSentinels.decode(Number.NaN)).toBeNaN();
    expect(Object.is(numericSentinels.encode(-0), -0)).toBe(true);
    expect(numericSentinels.safeDecode(0).ok).toBe(false);

    expectTypeOf<InferValue<typeof multi>>().toEqualTypeOf<
      Date | typeof stamp | 0 | false | null | undefined
    >();
    expectTypeOf<InferEncoded<typeof multi>>().toEqualTypeOf<
      string | 0 | false | null | undefined
    >();
  });

  test("or 在定义期校验字面量参数", () => {
    const base = number();
    expect(base.or("auto", "inherit").decode("inherit")).toBe("inherit");
    for (const args of [[], [{}], [[]], [string()], [1n], [Symbol()]]) {
      expect(() => Reflect.apply(base.or, undefined, args)).toThrow(TypeError);
    }
  });

  test("原生兼容 StandardSchemaV1 接口与输入输出类型推导", () => {
    function acceptStandard<I, O>(schema: StandardSchemaV1<I, O>) {
      return schema["~standard"];
    }

    const standard = acceptStandard(intFromString);
    expect(standard.version).toBe(1);
    expect(standard.vendor).toBe("modvia");
    expect(standard.validate("18")).toStrictEqual({ value: 18 });
    expect(standard.validate("nope")).toMatchObject({
      issues: [{ path: [], message: "Expected an integer string" }],
    });

    type Types = NonNullable<(typeof intFromString)["~standard"]["types"]>;
    expectTypeOf<Types["input"]>().toEqualTypeOf<string>();
    expectTypeOf<Types["output"]>().toEqualTypeOf<number>();
  });

  test("arrayOf 接受纯值 Codec 或自定义 CodecLike，拒绝带属性修饰的 Field", () => {
    const plainCodec: CodecLike<string, string> = {
      decode: (input) => String(input),
      encode: (value) => String(value),
    };
    expect(arrayOf(plainCodec).parse([1, "a"])).toStrictEqual(["1", "a"]);

    const aliasedField = string().alias("item_code").optional();
    expect(arrayOf(aliasedField.codec).decode(["a"])).toStrictEqual(["a"]);

    // @ts-expect-error Field 携带对象属性修饰，不能直接作为数组元素 Codec
    expect(() => arrayOf(string().optional())).toThrow(TypeError);
    // @ts-expect-error Field 携带外部键别名，不能直接作为数组元素 Codec
    expect(() => arrayOf(string().alias("code"))).toThrow(TypeError);
    // @ts-expect-error Field.of() 显式包装后的属性描述符同样不可直接放入数组
    expect(() => arrayOf(Field.of(string()))).toThrow(TypeError);

    expectTypeOf(arrayOf(string())).toEqualTypeOf<ArrayCodec<string>>();
  });

  test("Codec.fromStandard 将同步 StandardSchemaV1 校验器桥接为双向对称 Codec", () => {
    const emailStandard: StandardSchemaV1<string, string> = {
      "~standard": {
        version: 1,
        vendor: "custom-validator",
        validate(value) {
          if (typeof value !== "string" || !value.includes("@")) {
            return {
              issues: [{ message: "Invalid email", path: [{ key: "address" }] }],
            };
          }
          return { value: value.trim() };
        },
      },
    };

    const Email = Codec.fromStandard(emailStandard);
    expect(Email.decode(" a@b.com ")).toBe("a@b.com");
    expect(Email.encode(" a@b.com ")).toBe("a@b.com");
    expect(Email.safeDecode("invalid")).toStrictEqual({
      ok: false,
      issues: [{ path: ["address"], code: "standard.invalid", message: "Invalid email" }],
    });

    const asyncSchema: StandardSchemaV1<string, string> = {
      "~standard": {
        version: 1,
        vendor: "async-validator",
        validate: async (value) => ({ value: String(value) }),
      },
    };
    const AsyncWrapped = Codec.fromStandard(asyncSchema);
    expect(() => AsyncWrapped.safeDecode("x")).toThrow(TypeError);
  });

  test("brand 在解码端附加编译期名义类型且编码端保持原始外部类型，运行时零额外包装", () => {
    const base = string().trim().nonEmpty();
    const UserId = base.brand<"UserId">();
    const OrderId = base.brand<"OrderId">();

    // 运行时直接复用原 Codec 实例
    expect(UserId).toBe(base);

    const uid = UserId.decode("  u-1  ");
    expect(uid).toBe("u-1");
    expect(UserId.encode(uid)).toBe("u-1");

    expectTypeOf(uid).toEqualTypeOf<Branded<string, "UserId">>();
    expectTypeOf<InferEncoded<typeof UserId>>().toEqualTypeOf<string>();

    function acceptUserId(id: Branded<string, "UserId">): string {
      return id;
    }
    acceptUserId(uid);
    const oid = OrderId.decode("o-1");
    // @ts-expect-error 不同品牌名义类型不可混用
    acceptUserId(oid);
    // @ts-expect-error 裸 string 不可直接传入品牌参数
    acceptUserId("u-1");
  });

  test("Codec.inspect 与 .describe 公开只读结构描述符，并在精化/规范化/品牌/字段与工厂派生下保持结构透明", () => {
    const Username = string()
      .trim()
      .minLength(3)
      .maxLength(16)
      .pattern(/^[a-z0-9_]+$/)
      .describe("Unique handle")
      .normalize((s) => s.toLowerCase())
      .refine((s) => !s.startsWith("_"), "user.leading_underscore", "No leading underscore")
      .brand<"Username">();

    expect(Codec.inspect(Username)).toStrictEqual({
      kind: "string",
      trim: true,
      minLength: 3,
      maxLength: 16,
      pattern: "^[a-z0-9_]+$",
      description: "Unique handle",
    });
    expect(Codec.inspect(Username.alias("user_name").optional())).toBe(Codec.inspect(Username));
    expect(Codec.inspect(int().min(0).max(10))).toStrictEqual({
      kind: "integer",
      min: 0,
      max: 10,
    });

    const NullableDate = isoDateTime().nullable().describe("Optional timestamp");
    expect(Codec.inspect(NullableDate)).toMatchObject({
      kind: "or",
      literals: [null],
      description: "Optional timestamp",
    });

    const ItemA = Model.define({
      fields: { type: literal("a").alias("item_type"), val: Username },
    });
    const ItemB = Model.define({ fields: { type: literal("b").alias("item_type") } });
    const DerivedA = ItemA.describe("Variant A").withFactory((d) => ({ ...d, extra: true }));
    expect(Codec.inspect(DerivedA)).toStrictEqual({
      kind: "model",
      fields: ItemA.fields,
      strict: false,
      description: "Variant A",
    });

    const Poly = Model.union("type", [DerivedA, ItemB]);
    expect(Codec.inspect(Poly)).toMatchObject({
      kind: "taggedUnion",
      discriminator: "type",
      externalKey: "item_type",
    });

    const CustomDecimal = Codec.define<number, string>({
      decode: (v) => Number(v),
      encode: (v) => String(v),
      meta: {
        format: "decimal",
        description: "Base-10 decimal string",
        encodedSchema: { type: "string", format: "decimal" },
      },
    });
    expect(Codec.inspect(CustomDecimal)).toStrictEqual({
      kind: "custom",
      format: "decimal",
      description: "Base-10 decimal string",
      encodedSchema: { type: "string", format: "decimal" },
    });

    // @ts-expect-error describe 必须传入字符串
    expect(() => string().describe(123)).toThrow(TypeError);
  });

  test("Codec.define 状态化定义支持 ctx.state、增量补丁与函数式演进、多余属性拦截及保留字守卫", () => {
    interface DecimalState {
      readonly scale: number;
      readonly min?: number;
    }

    const decimal = Codec.define({
      state: { scale: 2 } as DecimalState,
      validate(state) {
        if (!Number.isSafeInteger(state.scale) || state.scale < 0 || state.scale > 8) {
          throw new RangeError("scale must be an integer between 0 and 8");
        }
      },
      decode(input, ctx) {
        expect(Object.isFrozen(ctx.state)).toBe(true);
        if (typeof input !== "string" || !/^-?\d+(?:\.\d+)?$/.test(input)) {
          return ctx.fail("format.decimal", "Expected decimal string");
        }
        const parsed = Number(Number(input).toFixed(ctx.state.scale));
        if (ctx.state.min !== undefined && parsed < ctx.state.min) {
          return ctx.fail("number.min", `Expected >= ${ctx.state.min}`);
        }
        return Object.is(parsed, -0) ? 0 : parsed;
      },
      encode(input, ctx) {
        if (typeof input !== "number" || !Number.isFinite(input)) {
          return ctx.fail("type.number", "Expected finite number");
        }
        if (ctx.state.min !== undefined && input < ctx.state.min) {
          return ctx.fail("number.min", `Expected >= ${ctx.state.min}`);
        }
        return input.toFixed(ctx.state.scale);
      },
      meta: (state) => ({
        format: "decimal",
        encodedSchema: { type: "string" },
        decodedSchema: {
          type: "number",
          ...(state.min !== undefined ? { minimum: state.min } : {}),
        },
      }),
      methods: {
        // 直接返回增量补丁，参数签名即公开方法签名
        scale: (scale: number) => ({ scale }),
        min: (min: number) => ({ min }),
        nonNegative: () => ({ min: 0 }),
        // 需要基于旧状态演进时返回 (prev) => patch 函数
        raiseMin: (floor: number) => (prev) => ({
          min: prev.min === undefined ? floor : Math.max(prev.min, floor),
        }),
      },
    });

    // 原实例与链式派生实例完全不可变隔离，且多态 .describe 换序保留自有方法
    const Price = decimal.describe("Unit price").nonNegative().raiseMin(5).scale(3);
    expect(decimal.encode(1.5)).toBe("1.50");
    expect(Price.decode("12.3456")).toBe(12.346);
    expect(Price.encode(12.346)).toBe("12.346");
    expect(Price.safeDecode("4.99")).toMatchObject({
      ok: false,
      issues: [{ code: "number.min" }],
    });
    expect(Codec.inspect(Price)).toStrictEqual({
      kind: "custom",
      format: "decimal",
      description: "Unit price",
      encodedSchema: { type: "string" },
      decodedSchema: { type: "number", minimum: 5 },
    });

    // 定义期状态不变量校验在链式调用时立即生效
    expect(() => decimal.scale(-1)).toThrow(RangeError);
    expect(() => decimal.scale(12)).toThrow(RangeError);

    // 三阶单向跃迁：进入通用精化后不再暴露内禀自有方法
    const RefinedPrice = Price.refine((v) => v < 1000, "price.cap", "Too expensive");
    expectTypeOf(RefinedPrice).toEqualTypeOf<Codec<number, string>>();
    expect("scale" in RefinedPrice).toBe(false);

    // 编译期多余属性检查：拼错状态字段名立即被 TypeScript 拦截
    Codec.define({
      // @ts-expect-error typo 字段不存在于 Partial<DecimalState>
      state: { scale: 2 } as DecimalState,
      decode: (v) => Number(v),
      encode: (v) => String(v),
      methods: {
        badPatch: () => ({ scael: 4 }),
      },
    });

    // 保留字冲突在编译期与定义期双重拒绝
    const badMethods = { decode: () => ({ n: 2 }) };
    expect(() =>
      Codec.define({
        // @ts-expect-error 禁止覆盖 Codec 保留成员 decode
        state: { n: 1 },
        decode: (v) => Number(v),
        encode: (v) => Number(v),
        methods: badMethods,
      }),
    ).toThrow(RangeError);
  });
});
