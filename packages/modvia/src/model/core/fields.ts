import {
  getCodecRunner,
  getDefaultResolver,
  isFieldDescriptor,
  type InternalRunner,
} from "../../codec/core/runtime.ts";
import type { CodecLike, FieldPresence } from "../../codec/core/types.ts";
import { isObjectPrototype } from "../../shared/object.ts";
import type { FieldRecord } from "./types.ts";

export interface ResolvedField {
  readonly key: string;
  readonly source: string;
  readonly presence: FieldPresence;
  readonly resolveDefault?: () => unknown;
  readonly codec: CodecLike<unknown, unknown>;
  readonly runner: InternalRunner<unknown, unknown>;
}

export const resolvedFieldsSymbol = Symbol.for("modvia.resolvedFields");
export const missingField = Symbol("modvia.missingField");

const EMPTY_ARGS: readonly never[] = Object.freeze([]);

export function resolveFields(fields: FieldRecord): readonly ResolvedField[] {
  const resolved = Object.entries(fields).map(([key, entry]) => {
    const field = isFieldDescriptor(entry) ? entry : undefined;
    const rawSource = field?.source;
    const source = typeof rawSource === "string" ? rawSource : key;
    const presence: FieldPresence =
      field?.presence === "optional"
        ? "optional"
        : field?.presence === "defaulted"
          ? "defaulted"
          : "required";
    const resolveDefault = presence === "defaulted" ? getDefaultResolver(field) : undefined;
    if (presence === "defaulted" && resolveDefault === undefined) {
      throw new TypeError(`Defaulted field "${key}" is missing a default value resolver`);
    }

    const codec = field ? field.codec : (entry as CodecLike<unknown, unknown>);

    return Object.freeze({
      key,
      codec,
      runner: getCodecRunner(codec),
      source,
      presence,
      ...(resolveDefault ? { resolveDefault } : {}),
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

  let prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype === Object.prototype || prototype === null) {
    return missingField;
  }
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
