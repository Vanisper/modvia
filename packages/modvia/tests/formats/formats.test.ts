import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  email,
  ipv4,
  ipv6,
  isoDate,
  isoTime,
  jsonOf,
  jsonString,
  url,
  uuid,
} from "../../src/formats/index.ts";
import {
  defineModel,
  inspectCodec,
  snakeCase,
  string,
  type InferEncoded,
  type InferValue,
} from "../../src/index.ts";

describe("modvia/formats", () => {
  test("uuid 与 email 执行双向格式校验与幂等规范化", () => {
    const Uuid = uuid();
    expect(Uuid.decode("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(Uuid.encode("550E8400-E29B-41D4-A716-446655440000")).toBe(
      "550e8400-e29b-41d4-a716-446655440000",
    );
    expect(Uuid.safeDecode("bad-uuid")).toMatchObject({
      ok: false,
      issues: [{ code: "format.uuid" }],
    });
    expect(Uuid.safeParse(123)).toMatchObject({
      ok: false,
      issues: [{ code: "type.string" }],
    });
    expect(inspectCodec(Uuid)).toMatchObject({ kind: "custom", format: "uuid" });

    const Email = email({ trim: true, lowercase: true });
    expect(Email.decode("  User.Name+tag@Example.COM ")).toBe("user.name+tag@example.com");
    expect(Email.encode("User@Example.COM")).toBe("user@example.com");
    for (const invalid of ["plain", "@example.com", "a..b@example.com", ".a@example.com", "a@b"]) {
      expect(Email.safeDecode(invalid)).toMatchObject({
        ok: false,
        issues: [{ code: "format.email" }],
      });
    }
  });

  test("url、ipv4 与 ipv6 严格校验网络标识并支持协议白名单", () => {
    const HttpsOnly = url({ protocols: ["https"] });
    expect(HttpsOnly.decode("https://modvia.dev/docs?v=1")).toBe("https://modvia.dev/docs?v=1");
    expect(HttpsOnly.safeDecode("http://modvia.dev")).toMatchObject({
      ok: false,
      issues: [{ code: "format.url_protocol" }],
    });
    expect(HttpsOnly.safeDecode("javascript:alert(1)")).toMatchObject({
      ok: false,
      issues: [{ code: "format.url_protocol" }],
    });
    expect(HttpsOnly.safeDecode("https://example.com/with space")).toMatchObject({
      ok: false,
      issues: [{ code: "format.url" }],
    });
    expect(() => url({ protocols: [] })).toThrow(RangeError);

    const v4 = ipv4();
    expect(v4.decode("192.168.0.1")).toBe("192.168.0.1");
    for (const invalid of ["256.0.0.1", "192.168.01.1", "1.2.3", "1.2.3.4.5", "abc"]) {
      expect(v4.safeDecode(invalid)).toMatchObject({
        ok: false,
        issues: [{ code: "format.ipv4" }],
      });
    }

    const v6 = ipv6();
    for (const valid of [
      "2001:0db8:85a3:0000:0000:8a2e:0370:7334",
      "2001:db8::1",
      "::1",
      "::",
      "::ffff:192.0.2.128",
    ]) {
      expect(v6.decode(valid)).toBe(valid);
    }
    for (const invalid of [
      "2001::85a3::7334",
      "2001:db8:85a3:0:0:8a2e:370:7334:1",
      "fe80::1%eth0",
      "12345::1",
      ":1",
    ]) {
      expect(v6.safeDecode(invalid)).toMatchObject({
        ok: false,
        issues: [{ code: "format.ipv6" }],
      });
    }
  });

  test("isoDate 与 isoTime 精确校验公历闰年与日内时钟边界", () => {
    const DateStr = isoDate();
    expect(DateStr.decode("2024-02-29")).toBe("2024-02-29");
    for (const invalid of ["2026-02-29", "1900-02-29", "2026-13-01", "2026-04-31", "2026/01/01"]) {
      expect(DateStr.safeDecode(invalid)).toMatchObject({
        ok: false,
        issues: [{ code: "format.iso_date" }],
      });
    }

    const TimeStr = isoTime();
    expect(TimeStr.decode("23:59:59.125")).toBe("23:59:59.125");
    for (const invalid of ["24:00:00", "12:60:00", "12:00:60", "9:00:00"]) {
      expect(TimeStr.safeDecode(invalid)).toMatchObject({
        ok: false,
        issues: [{ code: "format.iso_time" }],
      });
    }
  });

  test("jsonString 与 jsonOf 打通 JSON 文本与领域模型的双向编解码", () => {
    const RawJson = jsonString();
    expect(RawJson.decode('{"ok":true}')).toStrictEqual({ ok: true });
    expect(RawJson.encode({ ok: true })).toBe('{"ok":true}');
    expect(RawJson.safeDecode("{bad")).toMatchObject({
      ok: false,
      issues: [{ code: "format.json" }],
    });
    expect(RawJson.safeDump(undefined)).toMatchObject({
      ok: false,
      issues: [{ code: "format.json" }],
    });
    expect(RawJson.safeDump(10n)).toMatchObject({
      ok: false,
      issues: [{ code: "format.json" }],
    });

    const EventPayload = defineModel({
      alias: snakeCase,
      fields: {
        eventId: uuid(),
        targetUrl: url({ protocols: ["https"] }),
        note: string().optional(),
      },
    });

    const EventJson = jsonOf(EventPayload);
    expectTypeOf<InferValue<typeof EventJson>>().toEqualTypeOf<{
      readonly eventId: string;
      readonly targetUrl: string;
      readonly note?: string;
    }>();
    expectTypeOf<InferEncoded<typeof EventJson>>().toEqualTypeOf<string>();

    const parsed = EventJson.parse(
      '{"event_id":"550E8400-E29B-41D4-A716-446655440000","target_url":"https://modvia.dev"}',
    );
    expect(parsed).toStrictEqual({
      eventId: "550e8400-e29b-41d4-a716-446655440000",
      targetUrl: "https://modvia.dev",
    });
    expect(EventJson.encode(parsed)).toBe(
      '{"event_id":"550e8400-e29b-41d4-a716-446655440000","target_url":"https://modvia.dev"}',
    );
  });
});
