import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  defineModel,
  field,
  isoDateTime,
  number,
  string,
  type Field,
  type InferData,
  type InferDTO,
} from "../src/index.ts";

describe("字段组合", () => {
  test("复用可带别名的字段时保留两种外部键名", () => {
    function product(sku: Field<string, string, "product_code" | undefined>) {
      return defineModel({ fields: { sku } });
    }

    type DTO = InferDTO<ReturnType<typeof product>>;
    expectTypeOf<DTO["sku"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<DTO["product_code"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<InferData<ReturnType<typeof product>>>().toEqualTypeOf<{ readonly sku: string }>();
    expect(product(string()).encode({ sku: "A" })).toStrictEqual({ sku: "A" });
    expect(product(string().from("product_code")).encode({ sku: "A" })).toStrictEqual({
      product_code: "A",
    });
  });

  test("or 双向优先保留显式字面量，其余值继续走原转换", () => {
    const stamp = "2026-01-01T00:00:00.000Z";
    const base = isoDateTime();
    const extended = base.or(stamp).or(0).or(false).or(null).or(undefined);
    for (const literal of [stamp, 0, false, null, undefined] as const) {
      expect(extended.decode(literal)).toBe(literal);
      expect(extended.encode(literal)).toBe(literal);
    }
    const date = new Date(stamp);
    expect(base.decode(stamp)).toEqual(date);
    expect(extended.decode("2026-01-01T00:00:00Z")).toEqual(date);
    expect(extended.encode(date)).toBe(stamp);
    const numericSentinels = string().or(NaN).or(-0);
    expect(numericSentinels.decode(NaN)).toBeNaN();
    expect(numericSentinels.encode(-0)).toBe(-0);
    expect(() => numericSentinels.decode(0)).toThrow();
    expectTypeOf<typeof extended.decode>().returns.toEqualTypeOf<
      Date | typeof stamp | 0 | false | null | undefined
    >();
    expectTypeOf<typeof extended.encode>().returns.toEqualTypeOf<
      string | 0 | false | null | undefined
    >();
  });

  test("or 在声明时检查参数个数和字面量种类", () => {
    const base = number();
    expect(base.or("auto").decode("auto")).toBe("auto");
    const or = base.or.bind(base);
    for (const args of [[], [null, undefined], [{}], [[]], [string()], [1n], [Symbol()]]) {
      expect(() => Reflect.apply(or, undefined, args)).toThrow(TypeError);
    }
  });

  test("optional 允许缺少键，显式 undefined 仍由值规则决定", () => {
    const SKU = string({ minLength: 1 });
    const required = defineModel({ fields: { sku: SKU.or(undefined) } });
    const optional = defineModel({ fields: { sku: SKU.optional() } });
    const both = defineModel({ fields: { sku: SKU.optional().or(undefined) } });

    expect(() => required.decode({})).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: ["sku"], code: "field.required" })],
      }),
    );
    // @ts-expect-error 缺少必填键时编码也会失败
    expect(() => required.encode({})).toThrow();
    expect(required.decode({ sku: undefined })).toStrictEqual({ sku: undefined });
    expect(required.encode({ sku: undefined })).toStrictEqual({ sku: undefined });
    expect(optional.decode({})).toStrictEqual({});
    expect(optional.encode({})).toStrictEqual({});
    expect(() => optional.decode({ sku: undefined })).toThrow();
    const encode = optional.encode.bind(optional);
    expect(() => Reflect.apply(encode, undefined, [{ sku: undefined }])).toThrow();
    expect(both.decode({})).toStrictEqual({});
    expect(both.encode({})).toStrictEqual({});
    expect(both.decode({ sku: undefined })).toStrictEqual({ sku: undefined });
    expect(both.encode({ sku: undefined })).toStrictEqual({ sku: undefined });
    expectTypeOf<InferData<typeof required>>().toEqualTypeOf<{
      readonly sku: string | undefined;
    }>();
    expectTypeOf<InferData<typeof both>>().toEqualTypeOf<{ readonly sku?: string | undefined }>();
  });

  test("展开字段保留别名和可选性，普通 Codec 的同名属性不参与字段声明", () => {
    const copy = { ...string().optional().from("external") };
    const plain = {
      source: "ignored",
      presence: "optional" as const,
      decode: (input: unknown) => string().decode(input),
      encode: (value: string) => value,
    };
    const model = defineModel({ fields: { code: copy, title: plain } });
    expect(model.decode({ external: "A", title: "B" })).toStrictEqual({ code: "A", title: "B" });
    expect(model.encode({ title: "B" })).toStrictEqual({ title: "B" });
    expect(model.encode({ code: "A", title: "B" })).toStrictEqual({ external: "A", title: "B" });
    expect(() => model.decode({ ignored: "B" })).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: ["title"], code: "field.required" })],
      }),
    );
  });

  test("数组元素和数组字段各自保留值域、外部名与缺省规则", () => {
    const item = isoDateTime().optional().from("element").or(null);
    const list = arrayOf(item);
    const required = defineModel({ fields: { dates: list } });
    const wrapped = defineModel({
      fields: { dates: field(list.or(false).from("event_dates").optional()) },
    });
    const reordered = defineModel({
      fields: { dates: list.optional().or(false).from("event_dates") },
    });
    const stamp = "2026-01-01T00:00:00.000Z";
    expect(required.decode({ dates: [null, stamp] })).toStrictEqual({
      dates: [null, new Date(stamp)],
    });
    expect(() => required.decode({})).toThrow();
    expect(() => list.decode([undefined])).toThrow();
    for (const model of [wrapped, reordered]) {
      expect(model.decode({})).toStrictEqual({});
      expect(model.encode({})).toStrictEqual({});
      expect(model.decode({ event_dates: false })).toStrictEqual({ dates: false });
      expect(model.encode({ dates: [new Date(stamp), null] })).toStrictEqual({
        event_dates: [stamp, null],
      });
      expect(() => model.decode({ event_dates: [null, false] })).toThrow(
        expect.objectContaining({
          issues: [expect.objectContaining({ path: ["event_dates", 1], code: "type.datetime" })],
        }),
      );
      expect(() => model.encode({ dates: [new Date(NaN)] })).toThrow(
        expect.objectContaining({
          issues: [expect.objectContaining({ path: ["dates", 0], code: "type.datetime" })],
        }),
      );
    }
    expectTypeOf<InferData<typeof required>>().toEqualTypeOf<{ readonly dates: (Date | null)[] }>();
    expectTypeOf<InferData<typeof wrapped>>().toEqualTypeOf<{
      readonly dates?: (Date | null)[] | false;
    }>();
    expectTypeOf<InferDTO<typeof wrapped>>().toEqualTypeOf<{
      readonly event_dates?: (string | null)[] | false;
    }>();
    expectTypeOf<InferDTO<typeof reordered>>().toEqualTypeOf<InferDTO<typeof wrapped>>();
  });
});
