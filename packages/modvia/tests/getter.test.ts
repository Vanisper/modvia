import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import { defineModel, number } from "../src/index.ts";

const Quantity = defineModel({ fields: { count: number().from("quantity") } });
const missingCount = expect.objectContaining({
  issues: [expect.objectContaining({ path: ["count"], code: "field.required" })],
});

describe("声明字段的 getter", () => {
  test("以原实例读取最近的原型 getter 一次，自有字段优先", () => {
    let reads = 0;
    class Counter {
      get count() {
        return 0;
      }
    }
    class Item extends Counter {
      #count = 3;
      override get count() {
        reads++;
        return this.#count;
      }
    }

    const item = new Item();
    expect(Quantity.encode(item)).toEqual({ quantity: 3 });
    expect(reads).toBe(1);

    Object.defineProperty(item, "count", { get: () => 7 });
    expect(Quantity.encode(item)).toEqual({ quantity: 7 });
    expect(reads).toBe(1);
  });

  test("getter 函数的同名 call 属性不影响字段读取", () => {
    class Item {
      declare readonly count: number;
    }
    const getCount = Object.assign(() => 3, { call: () => 9 });
    Object.defineProperty(Item.prototype, "count", { get: getCount });

    expect(Quantity.encode(new Item())).toEqual({ quantity: 3 });
  });

  test.each([
    ["数据属性", { value: 3 }],
    ["方法", { value: () => 3 }],
    ["只有 setter 的属性", { set: (_value: number) => {} }],
  ] as const)("原型上的%s遮蔽更远的 getter 时按缺字段处理", (_, descriptor) => {
    class Item {
      get count() {
        return 2;
      }
    }
    class SpecialItem extends Item {}
    Object.defineProperty(SpecialItem.prototype, "count", descriptor);
    expect(() => Quantity.encode(new SpecialItem())).toThrow(missingCount);
  });

  test("编码与解码都忽略 Object.prototype 上的 getter", () => {
    const key = "modviaTestInheritedCount";
    const Counter = defineModel({ fields: { [key]: number() } });
    const input = {} as { [key]: number };
    const missing = expect.objectContaining({
      issues: [expect.objectContaining({ path: [key], code: "field.required" })],
    });

    Object.defineProperty(Object.prototype, key, { configurable: true, get: () => 4 });
    try {
      expect(() => Counter.encode(input)).toThrow(missing);
      expect(() => Counter.decode(input)).toThrow(missing);
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
    }
  });

  test("跨上下文的普通对象可以解码，编码时忽略其 Object.prototype 上的 getter", () => {
    const plain = runInNewContext("({ quantity: 4 })");
    expect(Quantity.decode(plain)).toEqual({ count: 4 });

    const inherited = runInNewContext(
      "Object.defineProperty(Object.prototype, 'count', { get() { return 7 } }); ({})",
    ) as { count: number };
    expect(() => Quantity.encode(inherited)).toThrow(missingCount);
  });

  test("自定义原型自身以 null 为原型时仍可提供 getter", () => {
    const prototype = Object.create(null, { count: { get: () => 3 } });
    const counter = Object.create(prototype) as { count: number };
    expect(Quantity.encode(counter)).toEqual({ quantity: 3 });
    expect(() => Quantity.decode(counter)).toThrow(
      expect.objectContaining({ issues: [expect.objectContaining({ code: "type.object" })] }),
    );
  });

  test("解码与编码在结果上定义自有字段，避免触发原型上的同名访问器", () => {
    const key = "modviaTestOwnCount";
    const Counter = defineModel({ fields: { [key]: number() } });
    const own = { [key]: 7 };

    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      get: () => 3,
      set: () => {
        throw new Error("意外调用原型 setter");
      },
    });
    try {
      for (const output of [Counter.decode(own), Counter.encode(own)]) {
        expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
        expect(Object.getOwnPropertyDescriptor(output, key)).toEqual({
          value: 7,
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    } finally {
      Reflect.deleteProperty(Object.prototype, key);
    }
  });

  test("原型 getter 抛出的普通异常原样传播", () => {
    const error = new Error("计数器已关闭");
    class ClosedCounter {
      get count(): number {
        throw error;
      }
    }

    let thrown: unknown;
    try {
      Quantity.encode(new ClosedCounter());
    } catch (cause) {
      thrown = cause;
    }
    expect(thrown).toBe(error);
  });

  test("可选字段的 getter 返回 undefined 时保留键并校验值", () => {
    class Draft {
      get count() {
        return undefined;
      }
    }
    const draft = new Draft();
    const quantity = number().from("quantity").optional();
    const Numeric = defineModel({ fields: { count: quantity } });
    const Clearable = defineModel({ fields: { count: quantity.or(undefined) } });

    expect(() => Reflect.apply(Numeric.encode, undefined, [draft])).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: ["count"], code: "type.number" })],
      }),
    );
    expect(Clearable.encode(draft)).toStrictEqual({ quantity: undefined });
  });

  test("基础和派生模型均能编码 Map.size，解码仍要求普通对象", () => {
    const Collection = defineModel({ fields: { size: number() } });
    const MapCollection = Collection.withFactory(() => new Map<string, number>());
    const map = new Map([["a", 1]]);
    expect(Collection.encode(map)).toEqual({ size: 1 });
    expect(MapCollection.encode(map)).toEqual({ size: 1 });
    expect(() => MapCollection.decode(map)).toThrow(
      expect.objectContaining({
        issues: [expect.objectContaining({ path: [], code: "type.object" })],
      }),
    );
  });
});
