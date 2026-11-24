import { Alias, arrayOf, boolean, int, isoDateTime, literal, Model, oneOf, string } from "modvia";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";
import { zodCodec } from "@modvia/zod";

let sink: unknown;
const BENCH_RUN = { time: 250, warmupTime: 80 } as const;

const ModviaUser = Model.define({
  alias: Alias.snakeCase,
  fields: {
    id: string().nonEmpty(),
    displayName: string().trim().nonEmpty(),
    age: int().min(0).max(150),
    isActive: boolean().default(true),
    role: oneOf("member", "admin", "owner"),
    createdAt: isoDateTime(),
  },
});

const ZodIsoDateCodec = z.codec(z.iso.datetime({ offset: true }), z.date(), {
  decode: (raw) => new Date(raw),
  encode: (date) => date.toISOString(),
});

const ZodUserDtoSchema = z.object({
  id: z.string().min(1),
  display_name: z.string().trim().min(1),
  age: z.int().min(0).max(150),
  is_active: z.boolean().default(true),
  role: z.enum(["member", "admin", "owner"]),
  created_at: ZodIsoDateCodec,
});

const ZodOrderItem = z.object({
  sku: z.string().min(1),
  quantity: z.int().min(1).max(999),
  unit_price_cents: z.int().min(0),
});

const BridgedSymmetricItem = zodCodec(ZodOrderItem);

const ModviaOrderItem = Model.define({
  fields: {
    sku: string().nonEmpty(),
    quantity: int().min(1).max(999),
    unit_price_cents: int().nonNegative(),
  },
});

const ModviaOrderList = arrayOf(ModviaOrderItem);
const ZodOrderList = z.array(ZodOrderItem);

const sampleUserDto = {
  id: "usr_01J9Z7K8Q2",
  display_name: "  Lin Zhou  ",
  age: 29,
  role: "admin" as const,
  created_at: "2026-11-09T08:30:15.250Z",
};

const sampleModviaUser = ModviaUser.parse(sampleUserDto);
const sampleZodUser = ZodUserDtoSchema.decode(sampleUserDto);

const validItems100 = Array.from({ length: 100 }, (_, index) => ({
  sku: `SKU-${1000 + index}`,
  quantity: (index % 5) + 1,
  unit_price_cents: 1990 + index * 10,
}));

const invalidItems100 = Array.from({ length: 100 }, (_, index) => ({
  sku: "",
  quantity: -index,
  unit_price_cents: 1990,
}));

const ModviaTaggedEvent = Model.union("type", [
  Model.define({ fields: { type: literal("ev.1"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.2"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.3"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.4"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.5"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.6"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.7"), id: string(), seq: int() } }),
  Model.define({ fields: { type: literal("ev.8"), id: string(), amount: int().nonNegative() } }),
]);

const ZodTaggedEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("ev.1"), id: z.string(), seq: z.int() }),
  z.object({ type: z.literal("ev.2"), id: z.string(), seq: z.int() }),
  z.object({ type: z.literal("ev.3"), id: z.string(), seq: z.int() }),
  z.object({ type: z.literal("ev.4"), id: z.string(), seq: z.int() }),
  z.object({ type: z.literal("ev.5"), id: z.string(), seq: z.int() }),
  z.object({ type: z.literal("ev.6"), id: z.string(), seq: z.int() }),
  z.object({ type: z.literal("ev.7"), id: z.string(), seq: z.int() }),
  z.object({ type: z.literal("ev.8"), id: z.string(), amount: z.int().min(0) }),
]);

const eighthEventPayload = { type: "ev.8" as const, id: "evt_800", amount: 12_500 };

describe("Modvia vs Zod v4 跨库基准对比", () => {
  test(
    "扁平 DTO 双向编解码（含字符串裁剪、默认值与 ISO 时间互转）",
    { timeout: 30_000 },
    async ({ bench }) => {
      await bench.compare(
        bench("Modvia Model.parse (含 snakeCase -> camelCase)", () => {
          sink = ModviaUser.parse(sampleUserDto);
        }),
        bench("Zod v4 z.object + z.codec decode (无键名映射)", () => {
          sink = ZodUserDtoSchema.decode(sampleUserDto);
        }),
        bench("Modvia Model.encode (含 camelCase -> snakeCase)", () => {
          sink = ModviaUser.encode(sampleModviaUser);
        }),
        bench("Zod v4 z.object + z.codec encode (无键名映射)", () => {
          sink = ZodUserDtoSchema.encode(sampleZodUser);
        }),
        BENCH_RUN,
      );
      expect(sink).toBeDefined();
    },
  );

  test("100 元素对象数组解码", { timeout: 30_000 }, async ({ bench }) => {
    await bench.compare(
      bench("Modvia arrayOf(Model) parse (100 items)", () => {
        sink = ModviaOrderList.parse(validItems100);
      }),
      bench("Zod v4 z.array(z.object) parse (100 items)", () => {
        sink = ZodOrderList.parse(validItems100);
      }),
      BENCH_RUN,
    );
    expect(sink).toBeDefined();
  });

  test("单对象解码与 @modvia/zod 桥接开销", { timeout: 30_000 }, async ({ bench }) => {
    const singleItem = validItems100[0];
    await bench.compare(
      bench("Modvia Model.parse (single item)", () => {
        sink = ModviaOrderItem.parse(singleItem);
      }),
      bench("Zod v4 z.object.parse (single item)", () => {
        sink = ZodOrderItem.parse(singleItem);
      }),
      bench("@modvia/zod zodCodec.parse (single item)", () => {
        sink = BridgedSymmetricItem.parse(singleItem);
      }),
      BENCH_RUN,
    );
    expect(sink).toBeDefined();
  });

  test("8 分支判别联合解码（尾部分支命中）", { timeout: 30_000 }, async ({ bench }) => {
    await bench.compare(
      bench("Modvia Model.union parse", () => {
        sink = ModviaTaggedEvent.parse(eighthEventPayload);
      }),
      bench("Zod v4 z.discriminatedUnion parse", () => {
        sink = ZodTaggedEvent.parse(eighthEventPayload);
      }),
      BENCH_RUN,
    );
    expect(sink).toBeDefined();
  });

  test(
    "100 元素数组校验失败收集（200 条结构化错误物化）",
    { timeout: 30_000 },
    async ({ bench }) => {
      await bench.compare(
        bench("Modvia safeParse (200 issues)", () => {
          const res = ModviaOrderList.safeParse(invalidItems100);
          sink = res.ok ? res.value : res.issues;
        }),
        bench("Zod v4 safeParse (200 issues)", () => {
          const res = ZodOrderList.safeParse(invalidItems100);
          sink = res.success ? res.data : res.error.issues;
        }),
        BENCH_RUN,
      );
      expect(sink).toBeDefined();
    },
  );
});
