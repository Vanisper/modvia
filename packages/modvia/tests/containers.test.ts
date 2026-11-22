import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { isoDateTime, number, oneOf, recordOf, string } from "../src/codec/index.ts";
import { defineModel, type InferEncoded, type InferValue } from "../src/index.ts";

const Metric = defineModel({
  fields: {
    count: number(),
    updatedAt: isoDateTime().from("updated_at"),
  },
});

describe("containers (recordOf)", () => {
  test("recordOf 双向编解码任意字符串键字典并定位动态键错误路径", () => {
    const MetricsMap = recordOf(Metric);
    const decoded = MetricsMap.decode({
      views: { count: 10, updated_at: "2026-11-09T00:00:00Z" },
      likes: { count: 2, updated_at: "2026-11-09T01:00:00Z" },
    });

    expect(decoded.views.count).toBe(10);
    expect(decoded.views.updatedAt).toEqual(new Date("2026-11-09T00:00:00.000Z"));

    expect(MetricsMap.encode(decoded)).toStrictEqual({
      views: { count: 10, updated_at: "2026-11-09T00:00:00.000Z" },
      likes: { count: 2, updated_at: "2026-11-09T01:00:00.000Z" },
    });

    expect(
      MetricsMap.safeDecode({
        views: { count: "bad", updated_at: "2026-11-09T00:00:00Z" },
      }),
    ).toMatchObject({
      ok: false,
      issues: [{ path: ["views", "count"], code: "type.number" }],
    });

    for (const invalid of [null, [], new Date(), new Map()]) {
      expect(MetricsMap.safeDecode(invalid)).toMatchObject({
        ok: false,
        issues: [{ path: [], code: "type.object" }],
      });
    }
  });

  test("recordOf 支持受限键 Codec、检测转换后键名冲突并安全处理 __proto__", () => {
    const Locale = oneOf("zh-CN", "en-US");
    const Messages = recordOf(Locale, string({ trim: true, minLength: 1 }));

    const messages = Messages.decode({ "zh-CN": "  你好  " });
    expect(messages).toStrictEqual({ "zh-CN": "你好" });
    expect(Messages.encode(messages)).toStrictEqual({ "zh-CN": "你好" });

    expect(Messages.safeDecode({ "fr-FR": "Bonjour" })).toMatchObject({
      ok: false,
      issues: [{ path: ["fr-FR"], code: "string.one_of" }],
    });

    expectTypeOf<InferValue<typeof Messages>>().toEqualTypeOf<
      Partial<Record<"zh-CN" | "en-US", string>>
    >();
    expectTypeOf<InferEncoded<typeof Messages>>().toEqualTypeOf<
      Partial<Record<"zh-CN" | "en-US", string>>
    >();

    // 键转换后发生碰撞时报告 record.duplicate_key
    const TrimmedDict = recordOf(string({ trim: true }), number());
    expect(TrimmedDict.safeDecode({ a: 1, " a ": 2 })).toMatchObject({
      ok: false,
      issues: [{ path: [" a "], code: "record.duplicate_key" }],
    });

    // __proto__ 自有键安全往返
    const RawDict = recordOf(string());
    const protoPayload: unknown = JSON.parse('{"__proto__":"safe"}');
    const decodedProto = RawDict.decode(protoPayload);
    expect(Object.getPrototypeOf(decodedProto)).toBe(Object.prototype);
    expect(Object.hasOwn(decodedProto, "__proto__")).toBe(true);
    expect(decodedProto["__proto__"]).toBe("safe");

    // @ts-expect-error recordOf 不接受带属性修饰的 Field
    expect(() => recordOf(string().optional())).toThrow(TypeError);
  });
});
