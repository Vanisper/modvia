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

  // 已知缺陷：路径映射依赖逐层手工透传，`.or` 与 `Codec.lazy` 包装层遗漏了映射
  test.fails("经 nullable 包装的模型 check 同样翻译为外部键名", () => {
    expect(Stamped.nullable().check(flagCreatedAt).safeParse({ created_at: "x" })).toMatchObject({
      ok: false,
      issues: [{ path: ["created_at"], code: "stamp.flagged" }],
    });
  });

  test.fails("经 Codec.lazy 引用的模型 check 同样翻译为外部键名", () => {
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
});
