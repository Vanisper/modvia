import { runInNewContext } from "node:vm";
import { describe, expect, test } from "vite-plus/test";
import {
  isObject,
  isObjectPrototype,
  isPlainObject,
  writeOwnField,
} from "../../src/shared/object.ts";
import { deduplicateLiterals, formatLiteral, isPrimitiveLiteral } from "../../src/shared/value.ts";

describe("shared utilities", () => {
  test("object 工具准确判定跨上下文纯对象并安全定义自有数据属性", () => {
    expect(isObject({})).toBe(true);
    expect(isObject([])).toBe(false);
    expect(isObject(null)).toBe(false);

    expect(isPlainObject({})).toBe(true);
    expect(isPlainObject(Object.create(null))).toBe(true);
    expect(isPlainObject(runInNewContext("({ a: 1 })"))).toBe(true);
    expect(isPlainObject(new Date())).toBe(false);
    expect(isObjectPrototype(Object.prototype)).toBe(true);
    expect(isObjectPrototype(runInNewContext("Object.prototype") as object)).toBe(true);

    const target: Record<string, unknown> = {};
    writeOwnField(target, "__proto__", "safe");
    expect(Object.getPrototypeOf(target)).toBe(Object.prototype);
    expect(Object.hasOwn(target, "__proto__")).toBe(true);
    expect(target["__proto__"]).toBe("safe");
  });

  test("value 工具按 Object.is 去重原始字面量并稳定格式化展示文本", () => {
    expect(isPrimitiveLiteral("a")).toBe(true);
    expect(isPrimitiveLiteral(0)).toBe(true);
    expect(isPrimitiveLiteral(false)).toBe(true);
    expect(isPrimitiveLiteral(null)).toBe(true);
    expect(isPrimitiveLiteral(undefined)).toBe(true);
    expect(isPrimitiveLiteral(1n)).toBe(false);
    expect(isPrimitiveLiteral({})).toBe(false);

    const deduped = deduplicateLiterals([0, Number.NaN], [-0, 0, Number.NaN, "ok"]);
    expect(Object.isFrozen(deduped)).toBe(true);
    expect(deduped).toHaveLength(4);
    expect(Object.is(deduped[0], 0)).toBe(true);
    expect(Number.isNaN(deduped[1])).toBe(true);
    expect(Object.is(deduped[2], -0)).toBe(true);
    expect(deduped[3]).toBe("ok");

    expect(formatLiteral("text")).toBe('"text"');
    expect(formatLiteral(-0)).toBe("-0");
    expect(formatLiteral(0)).toBe("0");
    expect(formatLiteral(null)).toBe("null");
  });
});
