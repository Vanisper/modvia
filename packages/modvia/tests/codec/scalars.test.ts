import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import {
  boolean,
  int,
  isoDateTime,
  number,
  oneOf,
  string,
  unknown,
} from "../../src/codec/index.ts";
import { defineModel } from "../../src/index.ts";

const instant = isoDateTime();

describe("built-in scalars", () => {
  test("string 按配置执行 trim、UTF-16 长度上下界与无状态正则校验，并在定义期检查参数", () => {
    const slug = string({
      trim: true,
      minLength: 2,
      maxLength: 8,
      pattern: /^[a-z0-9-]+$/g, // 即使传入带 g 标志的正则，连续调用亦保持无状态幂等
    });
    expect(slug.decode("  ab-12  ")).toBe("ab-12");
    expect(slug.decode("  ab-12  ")).toBe("ab-12");
    expect(slug.encode("  ab-12  ")).toBe("ab-12");
    expect(slug.safeDecode(" a ")).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "string.min_length" }],
    });
    expect(slug.safeDecode("too-long-slug")).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "string.max_length" }],
    });
    expect(slug.safeDecode("Bad_Slug")).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "string.pattern" }],
    });
    expect(slug.safeParse(12)).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "type.string" }],
    });
    expect(slug.safeDump(12)).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "type.string" }],
    });

    expect(string({ minLength: 2 }).decode("🙂")).toBe("🙂");

    for (const invalid of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => string({ minLength: invalid })).toThrow(RangeError);
      expect(() => string({ maxLength: invalid })).toThrow(RangeError);
    }
    expect(() => string({ minLength: 5, maxLength: 3 })).toThrow(RangeError);
    // @ts-expect-error pattern 必须为 RegExp 实例
    expect(() => string({ pattern: "^a$" })).toThrow(TypeError);
  });

  test("number、int、boolean 与 oneOf 严格校验基础类型、数值闭区间与枚举范围", () => {
    const percentage = number({ min: 0, max: 100 });
    expect(percentage.decode(0)).toBe(0);
    expect(percentage.encode(100)).toBe(100);
    expect(percentage.safeDecode(-0.1)).toMatchObject({
      ok: false,
      issues: [{ code: "number.min" }],
    });
    expect(percentage.safeEncode(100.1)).toMatchObject({
      ok: false,
      issues: [{ code: "number.max" }],
    });
    for (const invalid of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "1"]) {
      expect(percentage.safeParse(invalid)).toMatchObject({
        ok: false,
        issues: [{ code: "type.number" }],
      });
    }
    expect(() => number({ min: Number.NaN })).toThrow(RangeError);
    expect(() => number({ min: 10, max: 5 })).toThrow(RangeError);

    const flag = boolean();
    expect(flag.decode(false)).toBe(false);
    expect(flag.safeParse(0)).toMatchObject({
      ok: false,
      issues: [{ code: "type.boolean" }],
    });

    expect(() => oneOf()).toThrow(RangeError);
    const role = oneOf("admin", "member");
    expect(role.decode("admin")).toBe("admin");
    expect(role.safeParse("guest")).toMatchObject({
      ok: false,
      issues: [{ code: "string.one_of" }],
    });

    const port = int({ min: 1, max: 65535 });
    expect(port.decode(8080)).toBe(8080);
    expect(port.encode(443)).toBe(443);
    expect(port.safeDecode(0)).toMatchObject({
      ok: false,
      issues: [{ code: "number.min" }],
    });
    expect(port.safeEncode(70000)).toMatchObject({
      ok: false,
      issues: [{ code: "number.max" }],
    });
    for (const invalid of [1.5, 1e25, Number.NaN, Number.POSITIVE_INFINITY, "1"]) {
      expect(port.safeParse(invalid)).toMatchObject({
        ok: false,
        issues: [{ code: "type.integer" }],
      });
    }
    expect(() => int({ min: 1.5 })).toThrow(RangeError);
    expect(() => int({ min: 10, max: 5 })).toThrow(RangeError);

    const passthrough = unknown();
    const complex = { nested: [1, true, null] };
    expect(passthrough.decode(complex)).toBe(complex);
    expect(passthrough.encode(undefined)).toBeUndefined();
  });

  test("isoDateTime 支持四位年与扩展年份按同一时间点往返", () => {
    for (const [input, utc] of [
      ["0000-01-01T00:00:00+00:01", "-000001-12-31T23:59:00.000Z"],
      ["9999-12-31T23:59:59.999-00:01", "+010000-01-01T00:00:59.999Z"],
      ["+001970-01-01T00:00:00Z", "1970-01-01T00:00:00.000Z"],
    ]) {
      const date = instant.decode(input);
      expect(instant.encode(date)).toBe(utc);
      expect(instant.decode(utc).getTime()).toBe(date.getTime());
    }
  });

  test("isoDateTime 按偏移换算后的毫秒值判断原生 Date 端点", () => {
    for (const [input, utc, time] of [
      ["-271821-04-19T00:01:00-23:59", "-271821-04-20T00:00:00.000Z", -8.64e15],
      ["+275760-09-13T23:59:00+23:59", "+275760-09-13T00:00:00.000Z", 8.64e15],
    ] as const) {
      expect(instant.decode(input).getTime()).toBe(time);
      expect(instant.encode(new Date(time))).toBe(utc);
      expect(instant.decode(utc).getTime()).toBe(time);
    }

    const Event = defineModel({ fields: { at: instant.alias("starts_at") } });
    for (const input of ["-271821-04-19T00:00:59.999-23:59", "+275760-09-13T23:59:00.001+23:59"]) {
      expect(Event.safeDecode({ starts_at: input })).toMatchObject({
        ok: false,
        issues: [{ path: ["starts_at"], code: "datetime.out_of_range" }],
      });
    }
  });

  test("isoDateTime 编码支持跨上下文实例与自定义 Date 子类", () => {
    class DisplayDate extends Date {
      override toISOString() {
        return "本地展示文本";
      }
    }
    const foreignDate = runInNewContext("new Date(0)") as Date;
    for (const value of [new DisplayDate(0), foreignDate]) {
      const encoded = instant.encode(value);
      expect(encoded).toBe("1970-01-01T00:00:00.000Z");
      expect(instant.decode(encoded).getTime()).toBe(0);
    }
    expect(instant.safeEncode(new Date(Number.NaN))).toMatchObject({
      ok: false,
      issues: [{ code: "type.datetime" }],
    });
    expect(instant.safeDump("not-a-date")).toMatchObject({
      ok: false,
      issues: [{ code: "type.datetime" }],
    });
  });

  test("isoDateTime 先校验输入日历日期与偏移，再截断亚毫秒精度", () => {
    expect(instant.encode(instant.decode("0000-02-29T00:15:00.1+05:30"))).toBe(
      "0000-02-28T18:45:00.100Z",
    );
    expect(instant.encode(instant.decode("0099-12-31T23:59:59.99999-00:01"))).toBe(
      "0100-01-01T00:00:59.999Z",
    );
    for (const input of [
      "-000000-01-01T00:00:00Z",
      "-000100-02-29T00:00:00Z",
      "1900-02-29T00:00:00+05:30",
      "2026-11-19",
      "2026-11-19T00:00:00",
      "2026-11-09T02:00:00+24:00",
      "2026-11-09T02:00:00-24:00",
      "2026-11-09T02:00:00+12:60",
      "2026-11-09T02:00:00-12:60",
    ]) {
      expect(instant.safeDecode(input)).toMatchObject({
        ok: false,
        issues: [{ code: "datetime.invalid" }],
      });
    }
  });
});
