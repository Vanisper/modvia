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

const customIntCodec = Codec.define<number, string>({
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
    const okDecoded = customIntCodec.safeDecode("42");
    expect(okDecoded).toStrictEqual({ ok: true, value: 42 });
    expect(Object.isFrozen(okDecoded)).toBe(true);

    const badDecoded = customIntCodec.safeDecode("abc");
    expect(badDecoded.ok).toBe(false);
    if (badDecoded.ok) throw new Error("Expected failure");
    expect(badDecoded.issues).toStrictEqual([
      { path: [], code: "number.integer_string", message: "Expected an integer string" },
    ]);
    expect(Object.isFrozen(badDecoded.issues)).toBe(true);
    expect(Object.isFrozen(badDecoded.issues[0]?.path)).toBe(true);

    expect(customIntCodec.safeEncode(42)).toStrictEqual({ ok: true, value: "42" });
    const badEncoded = customIntCodec.safeEncode(Number.NaN);
    expect(badEncoded).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "number.safe_integer" }],
    });

    // @ts-expect-error decode 编译期拒绝非 Encoded 类型
    expect(customIntCodec.safeDecode(42).ok).toBe(false);
    // @ts-expect-error encode 编译期拒绝非 T 类型
    expect(customIntCodec.safeEncode("42").ok).toBe(false);

    // parse / safeParse 与 dump / safeDump 接收任意 unknown 并在运行时安全校验
    const rawIn: unknown = "42";
    const rawOut: unknown = 42;
    expect(customIntCodec.parse(rawIn)).toBe(42);
    expect(customIntCodec.dump(rawOut)).toBe("42");
    expect(customIntCodec.safeParse(null)).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "number.integer_string" }],
    });
    expect(customIntCodec.safeDump(null)).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "number.safe_integer" }],
    });
    expect(() => customIntCodec.parse({})).toThrow(ValidationError);
    expect(() => customIntCodec.dump({})).toThrow(ValidationError);

    expectTypeOf<InferValue<typeof customIntCodec>>().toEqualTypeOf<number>();
    expectTypeOf<InferEncoded<typeof customIntCodec>>().toEqualTypeOf<string>();
  });

  test("ValidationError 支持跨上下文识别并格式化嵌套路径", () => {
    const matrix = arrayOf(arrayOf(customIntCodec));
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

    const standard = acceptStandard(customIntCodec);
    expect(standard.version).toBe(1);
    expect(standard.vendor).toBe("modvia");
    expect(standard.validate("18")).toStrictEqual({ value: 18 });
    expect(standard.validate("nope")).toMatchObject({
      issues: [{ path: [], message: "Expected an integer string" }],
    });

    type Types = NonNullable<(typeof customIntCodec)["~standard"]["types"]>;
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
    // 相邻 .or() 合并时保留外层已声明的 description 元数据
    expect(Codec.inspect(string().or("auto").describe("Mode").or(null))).toMatchObject({
      kind: "or",
      literals: ["auto", null],
      description: "Mode",
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

    // Model 与特征 Codec 在 nullable / pipe 组合下保持外层实例引用同一性
    expect(Codec.inspect(DerivedA.nullable())).toStrictEqual({
      kind: "or",
      base: DerivedA,
      literals: [null],
    });
    const trimmed = string().trim();
    expect(Codec.inspect(trimmed.pipe(int().fromString()))).toMatchObject({
      kind: "pipe",
      first: trimmed,
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

    // 保留字冲突在编译期与定义期双重拒绝，且定义期校验非法参数与非纯对象状态
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

    expect(() => Reflect.apply(Codec.define, undefined, [null])).toThrow(TypeError);
    expect(() => Reflect.apply(Codec.define, undefined, [{}])).toThrow(TypeError);
    const nonPlainState = new Date(0);
    expect(() =>
      Codec.define({
        state: nonPlainState,
        decode: (v) => v,
        encode: (v) => v,
        methods: {},
      }),
    ).toThrow(TypeError);
    expect(Object.isFrozen(nonPlainState)).toBe(false);
  });

  test("每次顶层调用独占收集器，嵌套重入与未捕获异常后保持路径与错误完全隔离，回调结束后 context 立即失效", () => {
    const InnerPositive = Codec.define({
      state: { min: 1 },
      decode(input, ctx): number {
        if (typeof input !== "number" || input < ctx.state.min) {
          ctx.issue({ code: "inner.min", message: "too small" });
        }
        return Number(input);
      },
      encode(input): number {
        return Number(input);
      },
      methods: {},
    });

    const ReentrantOuter = Codec.define({
      state: { bonus: 10 },
      decode(input, ctx): number {
        // 在外层收集器尚处于活跃状态时重入触发独立的顶层 safeParse（失败与成功各一次）
        const rejected = InnerPositive.safeParse(0);
        expect(rejected.ok).toBe(false);
        const accepted = InnerPositive.parse(5);
        if (typeof input !== "number") {
          ctx.issue({ path: ["payload"], code: "outer.type", message: "expected number" });
          return 0;
        }
        if (input === -999) {
          throw new Error("fatal-custom-bug");
        }
        return input + accepted + ctx.state.bonus;
      },
      encode(input): number {
        return Number(input) - 15;
      },
      methods: {},
    });

    const Container = arrayOf(ReentrantOuter);

    expect(Container.parse([2])).toEqual([17]);
    expect(Container.safeParse(["bad"])).toEqual({
      ok: false,
      issues: [{ path: [0, "payload"], code: "outer.type", message: "expected number" }],
    });

    // 深层自定义异常中断后，后续调用不得继承残留路径段或脏问题列表
    expect(() => Container.parse(["bad-before-crash", -999])).toThrow("fatal-custom-bug");
    expect(() => Container.safeParse(["bad-before-crash", -999])).toThrow("fatal-custom-bug");
    expect(() => Container["~standard"].validate(["bad-before-crash", -999])).toThrow(
      "fatal-custom-bug",
    );
    expect(Container.safeParse(["after-crash"])).toEqual({
      ok: false,
      issues: [{ path: [0, "payload"], code: "outer.type", message: "expected number" }],
    });
    expect(InnerPositive.parse(3)).toBe(3);

    // 编解码执行结束后、同次调用兄弟字段/工厂阶段或重入子调用内误调非当前激活 context 均立即抛错拒绝
    let leakedCheckCtx: Parameters<Parameters<typeof InnerPositive.check>[0]>[1] | undefined;
    let leakedStatefulCtx:
      | {
          issue: (detail: { code: string; message: string }) => void;
          fail: (code: string, message: string) => never;
        }
      | undefined;
    const CheckedInner = InnerPositive.check((_val, ctx) => {
      leakedCheckCtx = ctx;
    });
    const StatefulCaptor = Codec.define({
      state: { tag: "v1" },
      decode(input, ctx): string {
        leakedStatefulCtx = ctx;
        return String(input);
      },
      encode: (input) => String(input),
      methods: {},
    });

    expect(CheckedInner.parse(5)).toBe(5);
    expect(StatefulCaptor.parse("ok")).toBe("ok");
    expect(() => leakedCheckCtx?.issue({ code: "stale.check", message: "late" })).toThrow(Error);
    expect(() => leakedStatefulCtx?.issue({ code: "stale.stateful", message: "late" })).toThrow(
      Error,
    );
    expect(() => leakedStatefulCtx?.fail("stale.fail", "late")).toThrow(Error);

    // 同一次顶层 Model.parse 内：字段 first 执行完毕后，兄弟字段 second 与 withFactory 均不得调用 first 泄露的 context
    const SiblingMisuseModel = Model.define({
      fields: {
        first: StatefulCaptor,
        second: Codec.define({
          decode(input): string {
            if (input === "misuse-issue") {
              leakedStatefulCtx?.issue({ code: "sibling.ghost", message: "cross-field" });
            }
            if (input === "misuse-fail") {
              leakedStatefulCtx?.fail("sibling.fail", "cross-field");
            }
            return String(input);
          },
          encode: (input) => String(input),
        }),
      },
    }).withFactory((data) => {
      if (data.second === "misuse-factory") {
        leakedStatefulCtx?.issue({ code: "factory.ghost", message: "in-factory" });
      }
      return data;
    });

    expect(() => SiblingMisuseModel.safeParse({ first: "a", second: "misuse-issue" })).toThrow(
      Error,
    );
    expect(() => SiblingMisuseModel.safeParse({ first: "a", second: "misuse-fail" })).toThrow(
      Error,
    );
    expect(() => SiblingMisuseModel.safeParse({ first: "a", second: "misuse-factory" })).toThrow(
      Error,
    );
    expect(SiblingMisuseModel.parse({ first: "a", second: "clean" })).toEqual({
      first: "a",
      second: "clean",
    });

    // 外层回调同步执行期间（含其内部发起的重入顶层调用）外层 context 仍属于外层自身的独立收集器：
    // 写入只影响外层本次结果，不会串入重入调用或后续调用
    let activeOuterCtx: { issue: (detail: { code: string; message: string }) => void } | undefined;
    const ReentrantChild = Codec.define({
      decode(input): string {
        if (input === "report-to-outer") {
          activeOuterCtx?.issue({ code: "outer.from_child", message: "reported during child" });
        }
        return String(input);
      },
      encode: (input) => String(input),
    });
    const ReentrantParent = Codec.define({
      decode(input, ctx): string {
        activeOuterCtx = ctx;
        const childResult = ReentrantChild.safeParse(input);
        expect(childResult).toEqual({ ok: true, value: input });
        if (input === "flag-after-child") {
          ctx.issue({ code: "parent.after_child", message: "resumed cleanly" });
        }
        return String(input);
      },
      encode: (input) => String(input),
    });

    expect(ReentrantParent.safeParse("report-to-outer")).toEqual({
      ok: false,
      issues: [{ path: [], code: "outer.from_child", message: "reported during child" }],
    });
    expect(ReentrantParent.safeParse("flag-after-child")).toEqual({
      ok: false,
      issues: [{ path: [], code: "parent.after_child", message: "resumed cleanly" }],
    });
    expect(() => activeOuterCtx?.issue({ code: "stale.parent", message: "late" })).toThrow(Error);

    // 即使经历上述所有拦截，后续解析结果中也绝不混入任何幽灵错误
    expect(StatefulCaptor.parse("clean")).toBe("clean");
    expect(InnerPositive.safeParse(0)).toEqual({
      ok: false,
      issues: [{ path: [], code: "inner.min", message: "too small" }],
    });

    // 跨副本互操作只走公开协议：伪造的全局符号 runner 与 INVALID 哨兵不会被识别，对象按 CodecLike 执行
    const forgedCodec = {
      [Symbol.toStringTag]: "modvia.Codec" as const,
      decode: (input: unknown) => input,
      encode: (input: unknown) => input,
    };
    Object.defineProperty(forgedCodec, Symbol.for("modvia.codecRunner"), {
      value: () => Symbol.for("modvia.invalid"),
    });
    expect(arrayOf(forgedCodec).safeParse([1])).toEqual({ ok: true, value: [1] });
    const forgedSentinel = Codec.define({
      decode: () => Symbol.for("modvia.invalid"),
      encode: (input) => input,
    });
    expect(forgedSentinel.safeParse(1)).toEqual({ ok: true, value: Symbol.for("modvia.invalid") });
  });
});
