import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { defineModel, isoDateTime } from "../src/index.ts";

const instant = isoDateTime();

describe("ISO 日期时间", () => {
  test("四位年与扩展年份按同一时间点往返", () => {
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

  test("按偏移换算后的毫秒值判断 Date 的两个端点", () => {
    for (const [input, utc, time] of [
      ["-271821-04-19T00:01:00-23:59", "-271821-04-20T00:00:00.000Z", -8.64e15],
      ["+275760-09-13T23:59:00+23:59", "+275760-09-13T00:00:00.000Z", 8.64e15],
    ] as const) {
      expect(instant.decode(input).getTime()).toBe(time);
      expect(instant.encode(new Date(time))).toBe(utc);
      expect(instant.decode(utc).getTime()).toBe(time);
    }
    const Event = defineModel({ fields: { at: instant.from("starts_at") } });
    for (const input of ["-271821-04-19T00:00:59.999-23:59", "+275760-09-13T23:59:00.001+23:59"]) {
      expect(() => Event.decode({ starts_at: input })).toThrow(
        expect.objectContaining({
          issues: [expect.objectContaining({ path: ["starts_at"], code: "datetime.out_of_range" })],
        }),
      );
    }
  });

  test("从 Date 的时间值编码，支持跨上下文实例和自定义子类", () => {
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
    expect(() => instant.encode(new Date(NaN))).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: "type.datetime" })] }),
    );
  });

  test("在输入的日历日期上校验，再按时区和毫秒精度换算", () => {
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
    ]) {
      expect(() => instant.decode(input)).toThrow(
        expect.objectContaining({
          issues: [expect.objectContaining({ code: "datetime.invalid" })],
        }),
      );
    }
  });
});
