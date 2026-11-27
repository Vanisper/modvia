import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { BUILTIN_ISSUE_CODES } from "../../src/codec/core/issues.ts";
import { jsonString, url } from "../../src/formats.ts";
import {
  arrayOf,
  boolean,
  Codec,
  int,
  isoDateTime,
  literal,
  Model,
  number,
  recordOf,
  string,
  tupleOf,
  ValidationError,
  type BuiltinIssueCode,
  type IssueCode,
} from "../../src/index.ts";

describe("错误码目录、结构化 params 与文档防漂移", () => {
  test("内置约束问题携带冻结的最小 params（无冗余字段、无可变对象）", () => {
    const minFail = int().min(3).safeDecode(1);
    expect(minFail).toStrictEqual({
      ok: false,
      issues: [
        { path: [], code: "integer.min", message: "Expected an integer >= 3", params: { min: 3 } },
      ],
    });
    if (minFail.ok) throw new Error("Expected failure");
    expect(Object.isFrozen(minFail.issues[0]?.params)).toBe(true);

    expect(int().gt(0).safeDecode(0)).toMatchObject({
      ok: false,
      issues: [{ code: "integer.gt", params: { gt: 0 } }],
    });
    expect(number().lt(1).safeDecode(1)).toMatchObject({
      ok: false,
      issues: [{ code: "number.lt", params: { lt: 1 } }],
    });

    // string.pattern 存正则源码字符串，不暴露可变 RegExp 实例
    const patternFail = string()
      .pattern(/^[a-z]+$/)
      .safeDecode("123");
    expect(patternFail).toMatchObject({
      ok: false,
      issues: [{ code: "string.pattern", params: { pattern: "^[a-z]+$" } }],
    });

    // literal.no_match 的 expected 数组冻结
    const litFail = literal("a", "b").safeParse("c");
    expect(litFail).toMatchObject({
      ok: false,
      issues: [{ code: "literal.no_match", params: { expected: ["a", "b"] } }],
    });
    if (litFail.ok) throw new Error("Expected failure");
    expect(Object.isFrozen(litFail.issues[0]?.params?.expected)).toBe(true);

    // url.protocol 携带实际协议与冻结白名单
    const urlFail = url().protocols("https", "wss").safeDecode("http://modvia.dev");
    expect(urlFail).toMatchObject({
      ok: false,
      issues: [
        { code: "url.protocol", params: { protocol: "http:", allowed: ["https:", "wss:"] } },
      ],
    });
    if (urlFail.ok) throw new Error("Expected failure");
    expect(Object.isFrozen(urlFail.issues[0]?.params?.allowed)).toBe(true);

    // boolean().fromString() 携带冻结真假词表
    const boolFail = boolean().fromString().tokens(["yes"], ["no"]).safeDecode("maybe");
    expect(boolFail).toMatchObject({
      ok: false,
      issues: [{ code: "format.boolean_string", params: { truthy: ["yes"], falsy: ["no"] } }],
    });

    // tuple.length、array.min_length、record.duplicate_key 与 object 键问题
    expect(tupleOf(string(), int()).safeParse(["a"])).toMatchObject({
      ok: false,
      issues: [{ code: "tuple.length", params: { expected: 2, actual: 1 } }],
    });
    expect(arrayOf(string()).minLength(2).safeDecode(["a"])).toMatchObject({
      ok: false,
      issues: [{ code: "array.min_length", params: { minLength: 2 } }],
    });
    expect(recordOf(string().trim(), int()).safeDecode({ a: 1, " a ": 2 })).toMatchObject({
      ok: false,
      issues: [{ path: [" a "], code: "record.duplicate_key", params: { key: "a" } }],
    });

    const StrictUser = Model.define({ fields: { id: string() } }).strict();
    expect(StrictUser.safeParse({ extra: 1 })).toMatchObject({
      ok: false,
      issues: [
        { path: ["id"], code: "object.missing_key", params: { key: "id" } },
        { path: ["extra"], code: "object.unknown_key", params: { key: "extra" } },
      ],
    });

    // 无参数问题不附带冗余 params 键
    const typeFail = string().safeParse(123);
    expect(typeFail).toStrictEqual({
      ok: false,
      issues: [{ path: [], code: "type.string", message: "Expected a string" }],
    });
    if (typeFail.ok) throw new Error("Expected failure");
    expect("params" in typeFail.issues[0]!).toBe(false);

    // isoDateTime 组按三层严格分离
    expect(isoDateTime().safeParse(123)).toMatchObject({
      ok: false,
      issues: [{ code: "type.string" }],
    });
    expect(isoDateTime().safeDecode("not-a-date")).toMatchObject({
      ok: false,
      issues: [{ code: "format.iso_datetime" }],
    });
    expect(isoDateTime().safeDecode("+999999-01-01T00:00:00Z")).toMatchObject({
      ok: false,
      issues: [{ code: "date.out_of_range" }],
    });
    expect(isoDateTime().safeDump(new Date(Number.NaN))).toMatchObject({
      ok: false,
      issues: [{ code: "type.date" }],
    });

    // jsonString 解码报 format.json，编码报 json.unserializable
    expect(jsonString().safeDecode("{bad")).toMatchObject({
      ok: false,
      issues: [{ code: "format.json" }],
    });
    expect(jsonString().safeDump(1n)).toMatchObject({
      ok: false,
      issues: [{ code: "json.unserializable" }],
    });
  });

  test("ValidationError 保留冻结 params，自定义 Codec 支持传入结构化 params 并拦截非法参数对象", () => {
    const Custom = Codec.define<number, number>({
      decode(input, ctx) {
        if (typeof input !== "number") return ctx.fail("type.number", "Expected a number");
        if (input % 2 !== 0) {
          return ctx.fail("custom.odd", "Expected even number", { divisor: 2, tags: ["even"] });
        }
        return input;
      },
      encode: (input) => Number(input),
    });

    let caught: unknown;
    try {
      Custom.decode(3);
    } catch (error) {
      caught = error;
    }
    if (!ValidationError.is(caught)) throw new Error("Expected ValidationError");
    expect(caught.issues).toStrictEqual([
      {
        path: [],
        code: "custom.odd",
        message: "Expected even number",
        params: { divisor: 2, tags: ["even"] },
      },
    ]);
    expect(Object.isFrozen(caught.issues[0]?.params)).toBe(true);
    expect(Object.isFrozen(caught.issues[0]?.params?.tags)).toBe(true);

    const BadParams = Codec.define<number, number>({
      decode(_input, ctx) {
        return ctx.fail("custom.bad", "bad", [] as unknown as Record<string, unknown>);
      },
      encode: (input) => Number(input),
    });
    expect(() => BadParams.safeParse(1)).toThrow(TypeError);

    expectTypeOf<BuiltinIssueCode>().toExtend<IssueCode>();
    const customCode: IssueCode = "app.custom_error";
    expect(customCode).toBe("app.custom_error");
  });

  test("packages/modvia/README.md 错误码速查表与内置错误码目录逐项一致（无漏项无漂移）", () => {
    const readmePath = resolve(import.meta.dirname, "../../README.md");
    const content = readFileSync(readmePath, "utf8");
    const sectionStart = content.indexOf("## 错误码速查");
    expect(sectionStart).toBeGreaterThan(-1);
    const nextHeading = content.indexOf("\n## ", sectionStart + 1);
    const section =
      nextHeading === -1 ? content.slice(sectionStart) : content.slice(sectionStart, nextHeading);
    const docCodes = [...section.matchAll(/^\|\s*`([a-z]+\.[a-z0-9_]+)`\s*\|/gm)].map(
      (match) => match[1]!,
    );

    expect(new Set(docCodes).size).toBe(docCodes.length);
    expect([...docCodes].sort()).toStrictEqual([...BUILTIN_ISSUE_CODES].sort());
  });
});
