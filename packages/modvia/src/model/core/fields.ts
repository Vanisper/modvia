import { toField } from "../../codec/core/codec.ts";
import { kernelOf, type Kernel } from "../../codec/core/internals.ts";
import type { Codec, FieldPresence } from "../../codec/core/types.ts";
import { isObjectPrototype } from "../../shared/object.ts";
import type { FieldRecord } from "./types.ts";

/** 字段表解析结果：外部键、缺省性、默认值提供器与执行内核在定义期一次性确定 */
export interface ResolvedField {
  readonly key: string;
  readonly source: string;
  readonly presence: FieldPresence;
  readonly fallback?: () => unknown;
  readonly codec: Codec<unknown, unknown>;
  readonly kernel: Kernel;
}

const resolvedFieldTables = new WeakMap<FieldRecord, readonly ResolvedField[]>();

/** 解析（并按字段表引用记忆）模型字段：经 toField 统一规范化，并在定义期校验外部键唯一性 */
export function resolveFields(fields: FieldRecord): readonly ResolvedField[] {
  const cached = resolvedFieldTables.get(fields);
  if (cached !== undefined) return cached;

  const owners = new Map<string, string>();
  const resolved = Object.entries(fields).map(([key, entry]): ResolvedField => {
    const field = toField(entry);
    const source = field.source ?? key;
    if (field.presence === "defaulted" && field.fallback === undefined) {
      throw new TypeError(`Defaulted field "${key}" is missing a default value resolver`);
    }
    const owner = owners.get(source);
    if (owner !== undefined) {
      throw new RangeError(`Duplicate field source "${source}" used by "${owner}" and "${key}"`);
    }
    owners.set(source, key);
    return Object.freeze({
      key,
      source,
      presence: field.presence,
      ...(field.fallback !== undefined ? { fallback: field.fallback } : {}),
      codec: field.codec,
      kernel: kernelOf(field.codec),
    });
  });

  const frozen = Object.freeze(resolved);
  resolvedFieldTables.set(fields, frozen);
  return frozen;
}

/** 编码读取协议中「声明字段缺失」的私有哨兵 */
export const missingField: unique symbol = Symbol("modvia.missingField");

const EMPTY_ARGS: readonly never[] = Object.freeze([]);

/** 读取业务对象的声明字段：自有属性优先，其次沿原型链读取最近的可读 getter（止于内建 Object.prototype） */
export function readModelField(value: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(value, key)) return value[key];

  let prototype = Object.getPrototypeOf(value) as object | null;
  while (prototype !== null && !isObjectPrototype(prototype)) {
    const descriptor: TypedPropertyDescriptor<unknown> | undefined =
      Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor) {
      // 原型链上最近的同名成员会遮蔽更上层的 getter
      return descriptor.get ? Reflect.apply(descriptor.get, value, EMPTY_ARGS) : missingField;
    }
    prototype = Object.getPrototypeOf(prototype) as object | null;
  }
  return missingField;
}
