import { runInNewContext } from "node:vm";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  defineCodec,
  field,
  fromStandard,
  isValidationError,
  isoDateTime,
  number,
  string,
  ValidationError,
  type Branded,
  type Codec,
  type CodecLike,
  type InferEncoded,
  type InferValue,
  type StandardSchemaV1,
} from "../../src/codec/index.ts";

const intFromString = defineCodec<number, string>({
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
    expect(isValidationError(caught)).toBe(true);
    if (!isValidationError(caught)) throw new Error("Expected ValidationError");
    expect(caught.message).toBe("[1][0]: Expected an integer string");

    const foreignLike = runInNewContext(
      `({ [Symbol.for("modvia.ValidationError")]: true, issues: [] })`,
    );
    expect(isValidationError(foreignLike)).toBe(true);
    expect(isValidationError(new Error("plain"))).toBe(false);
    expect(isValidationError(null)).toBe(false);
  });

  test("自定义 Codec 中的非校验异常原样向外传播", () => {
    const boom = new Error("storage unavailable");
    const broken = defineCodec<string, string>({
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
    // @ts-expect-error field() 显式包装后的属性描述符同样不可直接放入数组
    expect(() => arrayOf(field(string()))).toThrow(TypeError);

    expectTypeOf(arrayOf(string())).toEqualTypeOf<Codec<string[], string[]>>();
  });

  test("fromStandard 将同步 StandardSchemaV1 校验器桥接为双向对称 Codec", () => {
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

    const Email = fromStandard(emailStandard);
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
    const AsyncWrapped = fromStandard(asyncSchema);
    expect(() => AsyncWrapped.safeDecode("x")).toThrow(TypeError);
  });

  test("brand 在解码端附加编译期名义类型且编码端保持原始外部类型，运行时零额外包装", () => {
    const base = string({ trim: true, minLength: 1 });
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
});
