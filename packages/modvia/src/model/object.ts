import { isField } from "../codec/kernel.ts";
import type { CodecLike } from "../codec/types.ts";
import type { FieldRecord } from "./types.ts";

export interface ResolvedField {
  readonly key: string;
  readonly source: string;
  readonly optional: boolean;
  readonly codec: CodecLike<unknown, unknown>;
}

export const missingField = Symbol("modvia.missingField");

export function resolveFields(fields: FieldRecord): readonly ResolvedField[] {
  const resolved = Object.entries(fields).map(([key, entry]) => {
    const field = isField(entry) ? entry : undefined;
    const source = field?.source;
    return Object.freeze({
      key,
      codec: field?.codec ?? entry,
      source: typeof source === "string" ? source : key,
      optional: field?.presence === "optional",
    });
  });
  assertUniqueSources(resolved);
  return Object.freeze(resolved);
}

export function assertUniqueSources(resolvedFields: readonly ResolvedField[]): void {
  const owners = new Map<string, string>();
  for (const { key, source } of resolvedFields) {
    const owner = owners.get(source);
    if (owner !== undefined) {
      throw new RangeError(`Duplicate field source "${source}" used by "${owner}" and "${key}"`);
    }
    owners.set(source, key);
  }
}

export function writeOwnField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function readModelField(value: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(value, key)) return value[key];

  let prototype = Reflect.getPrototypeOf(value);
  while (prototype !== null && !isObjectPrototype(prototype)) {
    const descriptor: TypedPropertyDescriptor<unknown> | undefined =
      Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor) {
      // 原型链上最近的同名成员会遮蔽更上层的 getter
      return descriptor.get ? Reflect.apply(descriptor.get, value, []) : missingField;
    }
    prototype = Reflect.getPrototypeOf(prototype);
  }
  return missingField;
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || isObjectPrototype(prototype);
}

function isObjectPrototype(prototype: object): boolean {
  if (prototype === Object.prototype) return true;
  if (Reflect.getPrototypeOf(prototype) !== null) return false;

  // 跨上下文的内建 Object 经 Function.prototype 继承其所属上下文的 Object.prototype
  const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (typeof constructor !== "function") return false;
  const functionPrototype = Reflect.getPrototypeOf(constructor);
  return functionPrototype !== null && Reflect.getPrototypeOf(functionPrototype) === prototype;
}
