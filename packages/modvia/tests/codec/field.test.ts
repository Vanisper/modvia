import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  Codec,
  Field,
  isoDateTime,
  Model,
  number,
  string,
  type InferData,
  type InferDTO,
} from "../../src/index.ts";

describe("field binding", () => {
  test("复用纯 Codec 或带别名 Field 时保留全部候选外部键名", () => {
    function product(sku: Codec<string, string> | Field<string, string, "product_code">) {
      return Model.define({ fields: { sku } });
    }

    type DTO = InferDTO<ReturnType<typeof product>>;
    expectTypeOf<DTO["sku"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<DTO["product_code"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<InferData<ReturnType<typeof product>>>().toEqualTypeOf<{ readonly sku: string }>();
    expect(product(string()).encode({ sku: "A" })).toStrictEqual({ sku: "A" });
    expect(product(string().alias("product_code")).encode({ sku: "A" })).toStrictEqual({
      product_code: "A",
    });
  });

  test("alias 覆盖生效，optional 与 required 幂等转换，Field 精确暴露对象槽位属性与派生方法", () => {
    const base = number();
    const first = base.alias("old_key").optional();
    expect(first.optional()).toBe(first);

    const rebound = first.alias("new_key").required();
    expect(rebound.required()).toBe(rebound);
    expect(rebound.source).toBe("new_key");
    expect(rebound.presence).toBe("required");
    expect(rebound.codec).toBe(base);
    // 槽位数据为自有可枚举属性（FieldLike 纯数据协议），修饰方法位于原型
    expect(Object.keys(rebound).sort()).toStrictEqual([
      "codec",
      "description",
      "fallback",
      "presence",
      "source",
    ]);
    expect(rebound.codec.parse(5)).toBe(5);
    expect(rebound.codec.dump(5)).toBe(5);
    expect(rebound.codec.safeParse("bad").ok).toBe(false);
    expect(rebound.codec.safeDump("bad").ok).toBe(false);

    const CountModel = Model.define({ fields: { count: rebound } });
    expect(CountModel.decode({ new_key: 5 })).toStrictEqual({ count: 5 });
    // @ts-expect-error decode 编译期要求传入必填键 new_key
    expect(CountModel.safeDecode({}).ok).toBe(false);
    expect(CountModel.safeParse({})).toMatchObject({
      ok: false,
      issues: [{ path: ["new_key"], code: "field.required" }],
    });
  });

  test("optional 控制父对象缺键，显式 undefined 仍由值规则决定", () => {
    const SKU = string().nonEmpty();
    const required = Model.define({ fields: { sku: SKU.or(undefined) } });
    const optional = Model.define({ fields: { sku: SKU.optional() } });
    const both = Model.define({ fields: { sku: SKU.optional().or(undefined) } });

    expect(required.safeParse({})).toMatchObject({
      ok: false,
      issues: [{ path: ["sku"], code: "field.required" }],
    });
    // @ts-expect-error 缺少必填键时编码在编译期报错，运行时亦失败
    expect(() => required.encode({})).toThrow();
    expect(() => required.dump({})).toThrow();
    expect(required.decode({ sku: undefined })).toStrictEqual({ sku: undefined });
    expect(required.encode({ sku: undefined })).toStrictEqual({ sku: undefined });

    expect(optional.decode({})).toStrictEqual({});
    expect(optional.encode({})).toStrictEqual({});
    expect(optional.safeParse({ sku: undefined }).ok).toBe(false);
    expect(() => optional.dump({ sku: undefined })).toThrow();

    expect(both.decode({})).toStrictEqual({});
    expect(both.encode({})).toStrictEqual({});
    expect(both.decode({ sku: undefined })).toStrictEqual({ sku: undefined });
    expect(both.encode({ sku: undefined })).toStrictEqual({ sku: undefined });

    expectTypeOf<InferData<typeof required>>().toEqualTypeOf<{
      readonly sku: string | undefined;
    }>();
    expectTypeOf<InferData<typeof both>>().toEqualTypeOf<{ readonly sku?: string | undefined }>();
  });

  test("展开拷贝与跨副本纯数据 FieldLike 按公开协议识别，无标识自定义 CodecLike 的同名属性不参与字段声明", () => {
    const copy = { ...string().optional().alias("external") };
    const { codec, source, presence, description } = string().alias("ignored").optional();
    const tagged = {
      codec,
      source,
      presence,
      description,
      [Symbol.toStringTag]: "modvia.Field",
    } as const;
    const plain = {
      decode: codec.decode,
      encode: codec.encode,
      source: "ignored",
      presence: "optional",
    };
    expect(Field.is(copy)).toBe(true);
    expect(Field.is(tagged)).toBe(true);
    expect(Field.is(plain)).toBe(false);

    const named = Model.define({ fields: { title: tagged } });
    expectTypeOf<InferDTO<typeof named>>().toEqualTypeOf<{ readonly ignored?: string }>();
    expect(named.encode({ title: "B" })).toStrictEqual({ ignored: "B" });

    const model = Model.define({ fields: { code: copy, title: plain } });
    expectTypeOf<InferDTO<typeof model>>().toEqualTypeOf<{
      readonly external?: string;
      readonly title: string;
    }>();
    expect(model.decode({ external: "A", title: "B" })).toStrictEqual({ code: "A", title: "B" });
    expect(model.encode({ title: "B" })).toStrictEqual({ title: "B" });
    expect(model.encode({ code: "A", title: "B" })).toStrictEqual({ external: "A", title: "B" });
    expect(model.safeParse({ ignored: "B" })).toMatchObject({
      ok: false,
      issues: [{ path: ["title"], code: "field.required" }],
    });
  });

  test("Field 槽位级元数据（alias / optional / default / describe / or）在同一等级内完全顺序无关，且不克隆底层 codec", () => {
    const list = arrayOf(isoDateTime().nullable());
    const required = Model.define({ fields: { dates: list } });
    const wrapped = Model.define({
      fields: {
        dates: Field.of(list.or(false).alias("event_dates").optional().describe("Event schedule")),
      },
    });
    const reordered = Model.define({
      fields: {
        dates: list.optional().describe("Event schedule").or(false).alias("event_dates"),
      },
    });
    expect(wrapped.fields.dates.description).toBe("Event schedule");
    expect(reordered.fields.dates.description).toBe("Event schedule");
    expect(Codec.inspect(wrapped.fields.dates).description).toBe("Event schedule");
    expect(Codec.inspect(reordered.fields.dates).description).toBe("Event schedule");

    const baseStr = string();
    const describedSlot = baseStr.alias("item_code").describe("Code").optional();
    expect(describedSlot.codec).toBe(baseStr);
    expect(describedSlot.description).toBe("Code");
    expect(Codec.inspect(describedSlot).description).toBe("Code");
    expect(Codec.inspect(baseStr.describe("Code").alias("item_code").optional()).description).toBe(
      "Code",
    );

    const stamp = "2026-01-01T00:00:00.000Z";
    expect(required.decode({ dates: [null, stamp] })).toStrictEqual({
      dates: [null, new Date(stamp)],
    });
    expect(required.safeParse({}).ok).toBe(false);
    expect(list.safeParse([undefined]).ok).toBe(false);

    for (const model of [wrapped, reordered]) {
      expect(model.decode({})).toStrictEqual({});
      expect(model.encode({})).toStrictEqual({});
      expect(model.decode({ event_dates: false })).toStrictEqual({ dates: false });
      expect(model.encode({ dates: [new Date(stamp), null] })).toStrictEqual({
        event_dates: [stamp, null],
      });
      expect(model.safeParse({ event_dates: [null, false] })).toMatchObject({
        ok: false,
        issues: [{ path: ["event_dates", 1], code: "type.datetime" }],
      });
      expect(model.safeEncode({ dates: [new Date(Number.NaN)] })).toMatchObject({
        ok: false,
        issues: [{ path: ["dates", 0], code: "type.datetime" }],
      });
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

  test("default 仅在父对象缺键时填入业务默认值，防可变共享引用且满足往返收敛", () => {
    const Pagination = Model.define({
      fields: {
        page: number().default(1).alias("page_no"),
        tags: arrayOf(string()).default(() => []),
      },
    });

    const first = Pagination.decode({});
    const second = Pagination.decode({});
    expect(first).toStrictEqual({ page: 1, tags: [] });
    expect(first.tags).not.toBe(second.tags);
    expect(Pagination.encode(first)).toStrictEqual({ page_no: 1, tags: [] });

    // 键显式存在但值非法时照常报错，不静默兜底
    expect(Pagination.safeParse({ page_no: undefined }).ok).toBe(false);
    expect(Pagination.safeParse({ page_no: null }).ok).toBe(false);

    expectTypeOf<InferData<typeof Pagination>>().toEqualTypeOf<{
      readonly page: number;
      readonly tags: string[];
    }>();
    expectTypeOf<InferDTO<typeof Pagination>>().toMatchTypeOf<{
      page_no?: number;
      tags?: string[];
    }>();

    // @ts-expect-error 非原始可变值必须通过工厂函数提供默认值，防止实例间共享同一引用
    expect(() => arrayOf(string()).default([])).toThrow(TypeError);
  });
});
