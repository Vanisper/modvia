import { isField } from "../codec/kernel.ts";
import { isObjectPrototype } from "../codec/object-utils.ts";
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
