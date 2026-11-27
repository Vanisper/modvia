import { describe, expect, test } from "vite-plus/test";
import { jsonOf } from "../../src/formats.ts";
import {
  arrayOf,
  bigint,
  boolean,
  Codec,
  int,
  Model,
  number,
  string,
  type CodecContext,
} from "../../src/index.ts";

const Stamped = Model.define({ fields: { createdAt: string().alias("created_at") } });

function flagCreatedAt(value: { readonly createdAt: string } | null, ctx: CodecContext): void {
  if (value?.createdAt === "x") {
    ctx.issue({ code: "stamp.flagged", message: "flagged", path: ["createdAt"] });
  }
}

describe("跨层组合的结构契约", () => {
  test("模型 check 的声明字段路径在解码侧翻译为外部键名", () => {
    expect(Stamped.check(flagCreatedAt).safeParse({ created_at: "x" })).toMatchObject({
      ok: false,
      issues: [{ path: ["created_at"], code: "stamp.flagged" }],
    });
  });

  // 路径映射从描述符推导：or / refined / lazy / pipe 包装层统一穿透到模型
  test("经 nullable 包装的模型 check 同样翻译为外部键名", () => {
    expect(Stamped.nullable().check(flagCreatedAt).safeParse({ created_at: "x" })).toMatchObject({
      ok: false,
      issues: [{ path: ["created_at"], code: "stamp.flagged" }],
    });
  });

  test("经 Codec.lazy 引用的模型 check 同样翻译为外部键名", () => {
    expect(
      Codec.lazy(() => Stamped)
        .check(flagCreatedAt)
        .safeParse({ created_at: "x" }),
    ).toMatchObject({
      ok: false,
      issues: [{ path: ["created_at"], code: "stamp.flagged" }],
    });
  });

  test("describe 在全部带自有方法的 Codec 族上保留方法集合", () => {
    expect(string().describe("d").trim().decode(" a ")).toBe("a");
    expect(arrayOf(int()).describe("d").nonEmpty().safeDecode([]).ok).toBe(false);
    expect(int().describe("d").positive().fromString().decode("3")).toBe(3);
    expect(int().fromString().describe("d").positive().safeDecode("0").ok).toBe(false);
    expect(boolean().describe("d").fromString().caseSensitive().safeDecode("TRUE").ok).toBe(false);
    expect(string().trim().pipe(int().fromString()).describe("d").max(5).safeDecode("9").ok).toBe(
      false,
    );
    expect(jsonOf(arrayOf(string())).describe("d").maxLength(1).safeDecode('["a","b"]').ok).toBe(
      false,
    );
    const Defined = Codec.define({
      state: { suffix: "" },
      decode: (input, ctx) => `${String(input)}${ctx.state.suffix}`,
      encode: (input) => String(input),
      methods: { suffix: (suffix: string) => ({ suffix }) },
    });
    expect(Defined.describe("d").suffix("!").decode("a")).toBe("a!");
    const Described = Stamped.describe("d");
    expect(Described.strict().safeParse({ created_at: "a", extra: 1 }).ok).toBe(false);
    expect(Described.pick("createdAt").decode({ created_at: "a" })).toStrictEqual({
      createdAt: "a",
    });
  });

  test("describe 与 fromString 换序等价，外层说明完整保留", () => {
    for (const family of [int(), number(), bigint()] as const) {
      expect(Codec.inspect(family.describe("wire").fromString())).toStrictEqual(
        Codec.inspect(family.fromString().describe("wire")),
      );
      expect(Codec.inspect(family.describe("wire").fromString()).description).toBe("wire");
    }
    expect(Codec.inspect(boolean().describe("wire").fromString())).toStrictEqual(
      Codec.inspect(boolean().fromString().describe("wire")),
    );
    expect(Codec.inspect(boolean().describe("wire").fromString()).description).toBe("wire");
  });

  test("Codec.extendStandard 派生同构实例挂载 Standard Schema 扩展，扩展只属于该实例", () => {
    const converter = Object.freeze({ input: () => ({}), output: () => ({}) });
    const Base = Stamped.strict();
    const Extended = Codec.extendStandard(Base, { jsonSchema: converter });

    expect(Extended["~standard"].jsonSchema).toBe(converter);
    expect(Extended["~standard"].vendor).toBe("modvia");
    expect(Codec.inspect(Extended)).toStrictEqual(Codec.inspect(Base));
    expect(Extended.safeParse({ created_at: "a", extra: 1 }).ok).toBe(false);
    expect(arrayOf(Extended).decode([{ created_at: "a" }])).toStrictEqual([{ createdAt: "a" }]);
    expect(Extended.pick("createdAt").decode({ created_at: "b" })).toStrictEqual({
      createdAt: "b",
    });

    // 在扩展实例上继续派生的新定义不继承扩展
    expect("jsonSchema" in Extended.describe("next")["~standard"]).toBe(false);
    expect("jsonSchema" in Extended.strict()["~standard"]).toBe(true);
    const ExtendedInt = Codec.extendStandard(int(), { jsonSchema: converter });
    expect("jsonSchema" in ExtendedInt.min(1)["~standard"]).toBe(false);
    expect(ExtendedInt.fromString().decode("3")).toBe(3);

    expect(() => Codec.extendStandard(Base, { validate: () => ({}) })).toThrow(RangeError);
    expect(() =>
      Codec.extendStandard({ decode: String, encode: String } as never, { jsonSchema: converter }),
    ).toThrow(TypeError);
  });

  test("Codec.define 的 ctx.run 按方向分型、支持多错收集与反转方向，并守卫 Failed 契约", () => {
    const PortText = int().min(1).max(65535).fromString();
    const HostPort = Codec.define({
      decode(input, ctx) {
        if (typeof input !== "string") {
          return ctx.fail("type.string", "Expected host:port string");
        }
        const [rawHost, rawPort, ...extra] = input.split(":");
        if (extra.length > 0 || rawPort === undefined) {
          return ctx.fail("endpoint.syntax", "Expected host:port");
        }
        const host = ctx.run(string().trim().nonEmpty(), rawHost, "host");
        const port = ctx.run(PortText, rawPort, "port");
        if (ctx.failed(host)) return host;
        if (ctx.failed(port)) return port;
        return { host, port };
      },
      encode(input, ctx) {
        if (typeof input !== "object" || input === null) {
          return ctx.fail("type.object", "Expected endpoint object");
        }
        const candidate = input as Record<string, unknown>;
        const host = ctx.run(string().trim().nonEmpty(), candidate.host, "host");
        const port = ctx.run(PortText, candidate.port, "port");
        if (ctx.failed(host)) return host;
        if (ctx.failed(port)) return port;
        // encode 侧 ctx.run(PortText, ...) 静态推导为 string | Failed，经 failed 收窄后为 string
        const portText: string = port;
        return `${host}:${portText}`;
      },
    });

    const endpoint = HostPort.decode(" api.modvia.dev :443");
    expect(endpoint).toStrictEqual({ host: "api.modvia.dev", port: 443 });
    expect(HostPort.encode(endpoint)).toBe("api.modvia.dev:443");

    // 多个子 Codec 同时失败时收集全部问题与相对路径
    expect(HostPort.safeDecode(" :0")).toMatchObject({
      ok: false,
      issues: [
        { path: ["host"], code: "string.min_length" },
        { path: ["port"], code: "integer.min" },
      ],
    });
    expect(HostPort.safeDump({ host: "", port: 70000 })).toMatchObject({
      ok: false,
      issues: [
        { path: ["host"], code: "string.min_length" },
        { path: ["port"], code: "integer.max" },
      ],
    });

    // Codec.invert 后子 Codec 依然沿 handler 自身一侧运行
    const Inverted = Codec.invert(HostPort);
    expect(Inverted.decode({ host: "local", port: 8080 })).toBe("local:8080");
    expect(Inverted.encode("local:8080")).toStrictEqual({ host: "local", port: 8080 });

    // 外部 CodecLike 经 ctx.run 调用时，其 ValidationError 转为相对路径问题
    const foreignChild = {
      decode: (value: unknown) => int().parse(value),
      encode: (value: unknown) => int().dump(value),
    };
    const WrapForeign = Codec.define({
      decode(input, ctx) {
        const value = ctx.run(foreignChild, input, "inner");
        if (ctx.failed(value)) return value;
        return value;
      },
      encode: (input, ctx) => {
        const value = ctx.run(foreignChild, input, "inner");
        return ctx.failed(value) ? value : value;
      },
    });
    expect(WrapForeign.safeParse("bad")).toMatchObject({
      ok: false,
      issues: [{ path: ["inner"], code: "type.integer" }],
    });

    // 传入 Field 给 ctx.run 立即抛 TypeError
    const BadChild = Codec.define({
      decode(input, ctx) {
        return ctx.run(string().optional() as never, input);
      },
      encode: (input) => input,
    });
    expect(() => BadChild.safeParse("x")).toThrow(TypeError);

    // 缓存 Failed 并在无问题的运行中返回会触发 TypeError，守住「失败 ⇒ 至少一条问题」
    let cachedFailed: unknown;
    const ForgedReturn = Codec.define({
      decode(input, ctx) {
        if (input === "capture") {
          cachedFailed = ctx.run(int(), "not-int");
          return 0;
        }
        return cachedFailed as never;
      },
      encode: (input) => input,
    });
    expect(ForgedReturn.safeParse("capture").ok).toBe(false);
    expect(() => ForgedReturn.safeParse("forge")).toThrow(TypeError);

    // 回调结束后再调用 ctx.run 立即抛 Error，且原型冻结不可篡改 state 或覆盖方法
    let leakedCtx: { run(child: typeof PortText, input: unknown): unknown } | undefined;
    const CaptureRun = Codec.define({
      decode(input, ctx) {
        leakedCtx = ctx;
        expect(Object.isFrozen(Object.getPrototypeOf(ctx))).toBe(true);
        expect(() => {
          (ctx as unknown as { state: unknown }).state = { hacked: true };
        }).toThrow(TypeError);
        expect(() => {
          (ctx as unknown as { issue: unknown }).issue = () => {};
        }).toThrow(TypeError);
        return String(input);
      },
      encode: (input) => String(input),
    });
    expect(CaptureRun.parse("ok")).toBe("ok");
    expect(() => leakedCtx?.run(PortText, "80")).toThrow(Error);

    // context.issue 返回 Failed，可直接作为零抛错失败返回值，同时类型推导自动剥离 Failed
    const PositiveOdd = Codec.define({
      decode(input, ctx) {
        if (typeof input !== "number" || !Number.isSafeInteger(input)) {
          return ctx.issue({ code: "type.integer", message: "Expected a safe integer" });
        }
        if (input <= 0 || input % 2 === 0) {
          const marker = ctx.issue({
            code: "custom.positive_odd",
            message: "Expected positive odd",
          });
          expect(ctx.failed(marker)).toBe(true);
          return marker;
        }
        return input;
      },
      encode(input, ctx) {
        if (
          typeof input !== "number" ||
          !Number.isSafeInteger(input) ||
          input <= 0 ||
          input % 2 === 0
        ) {
          return ctx.issue({ code: "custom.positive_odd", message: "Expected positive odd" });
        }
        return input;
      },
    });
    const oddValue: number = PositiveOdd.decode(3);
    expect(oddValue).toBe(3);
    expect(PositiveOdd.safeDecode(4)).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "custom.positive_odd", message: "Expected positive odd" }],
    });
  });

  test("执行方法可解构独立调用，构建方法基于原型并要求有效 this，精化后不再视为静态字面量", () => {
    const Port = int().fromString();
    const { parse, safeParse, encode, dump } = Port;
    expect(["80", "443"].map(parse)).toStrictEqual([80, 443]);
    expect(safeParse("80")).toStrictEqual({ ok: true, value: 80 });
    expect([80, 443].map(encode)).toStrictEqual(["80", "443"]);
    expect(dump(80)).toBe("80");

    // 构建方法位于原型而非自有属性，且不可脱绑调用
    const baseInt = int();
    expect(Object.hasOwn(baseInt, "min")).toBe(false);
    expect(Object.hasOwn(baseInt, "fromString")).toBe(false);
    const detachedMin = baseInt.min;
    // @ts-expect-error 构建方法要求以标准 Codec 作为 this，不可脱绑直接调用
    expect(() => detachedMin(1)).toThrow(TypeError);
    // 即使盗取根原型的 fromString 强行绑定到已接上游的实例，运行时也拒绝
    const pipedInt = string().trim().pipe(int().fromString());
    const rootFromString = Reflect.get(baseInt, "fromString") as () => unknown;
    expect(() => Reflect.apply(rootFromString, pipedInt, [])).toThrow(TypeError);

    // 经过 refine 的字面量不再作为静态判别标签用于 Model.union
    const RefinedBranch = Model.define({
      fields: {
        kind: string()
          .or("a")
          .refine((v) => v === "a", "only.a", "only a"),
      },
    });
    const PlainBranch = Model.define({ fields: { kind: string().or("b") } });
    expect(() => Model.union("kind", [RefinedBranch, PlainBranch])).toThrow(TypeError);
  });
});
