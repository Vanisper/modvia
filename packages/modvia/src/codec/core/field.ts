import { isPrimitiveLiteral } from "../../shared/value.ts";
import { assertDescription, assertSource } from "./guards.ts";
import type { Codec, Field, FieldLike, FieldLiteral, FieldPresence } from "./types.ts";

/** Field 的完整槽位状态：每次修饰都基于它派生新的不可变实例 */
export interface FieldSpec {
  readonly codec: Codec<unknown, unknown>;
  readonly source: string | undefined;
  readonly presence: FieldPresence;
  readonly description?: string | undefined;
  readonly fallback?: (() => unknown) | undefined;
}

/**
 * 对象属性槽位描述符
 *
 * @description 槽位数据（codec / source / presence / description / fallback 与 Symbol.toStringTag）为自有可枚举属性，
 * 构成跨副本互操作的 FieldLike 纯数据协议；修饰方法位于原型并依赖 this
 */
class FieldImpl {
  readonly [Symbol.toStringTag] = "modvia.Field";
  readonly codec: Codec<unknown, unknown>;
  readonly source: string | undefined;
  readonly presence: FieldPresence;
  readonly description: string | undefined;
  readonly fallback: (() => unknown) | undefined;

  constructor(spec: FieldSpec) {
    this.codec = spec.codec;
    this.source = spec.source;
    this.presence = spec.presence;
    this.description = spec.description;
    this.fallback = spec.presence === "defaulted" ? spec.fallback : undefined;
  }

  alias(source: string): FieldImpl {
    assertSource(source);
    return this.#with({ source });
  }

  optional(): FieldImpl {
    return this.presence === "optional" ? this : this.#with({ presence: "optional" });
  }

  required(): FieldImpl {
    return this.presence === "required" ? this : this.#with({ presence: "required" });
  }

  default(provider: unknown): FieldImpl {
    return this.#with({ presence: "defaulted", fallback: toFallback(provider) });
  }

  or(...values: readonly FieldLiteral[]): FieldImpl {
    return this.#with({ codec: this.codec.or(...(values as [FieldLiteral])) });
  }

  nullable(): FieldImpl {
    return this.#with({ codec: this.codec.nullable() });
  }

  describe(description: string): FieldImpl {
    assertDescription(description);
    return this.#with({ description });
  }

  #with(patch: Partial<FieldSpec>): FieldImpl {
    return instantiateField({
      codec: this.codec,
      source: this.source,
      presence: this.presence,
      description: this.description,
      fallback: this.fallback,
      ...patch,
    });
  }
}

Object.freeze(FieldImpl.prototype);

function instantiateField(spec: FieldSpec): FieldImpl {
  const field = new FieldImpl(spec);
  Object.freeze(field);
  return field;
}

/** 由完整槽位状态构造不可变 Field 描述符 */
export function createField<
  T,
  Encoded,
  Source extends string | undefined,
  Presence extends FieldPresence,
>(
  spec: FieldSpec & {
    readonly codec: Codec<T, Encoded>;
    readonly source: Source;
    readonly presence: Presence;
  },
): Field<T, Encoded, Source, Presence> {
  return instantiateField(spec) as unknown as Field<T, Encoded, Source, Presence>;
}

/** 判断目标值是否为本副本构造的 Field 实例 */
export function isFieldInstance(
  value: unknown,
): value is Field<unknown, unknown, string | undefined, FieldPresence> {
  return value instanceof FieldImpl;
}

/** 按公开 FieldLike 纯数据协议结构化识别 Field（含跨副本实例与展开拷贝） */
export function isFieldLike(
  value: unknown,
): value is FieldLike<unknown, unknown, string | undefined, FieldPresence> {
  if (value instanceof FieldImpl) return true;
  if (typeof value !== "object" || value === null) return false;
  try {
    const candidate = value as Partial<FieldLike>;
    return (
      candidate[Symbol.toStringTag] === "modvia.Field" &&
      (candidate.presence === "required" ||
        candidate.presence === "optional" ||
        candidate.presence === "defaulted") &&
      (candidate.source === undefined || typeof candidate.source === "string") &&
      typeof candidate.codec === "object" &&
      candidate.codec !== null &&
      typeof candidate.codec.decode === "function" &&
      typeof candidate.codec.encode === "function"
    );
  } catch {
    return false;
  }
}

/** 规范化默认值提供器：原始字面量直接包装，非原始可变值必须通过工厂函数提供以防共享引用 */
export function toFallback<T>(provider: unknown): () => T {
  if (typeof provider === "function") {
    return provider as () => T;
  }
  if (isPrimitiveLiteral(provider)) {
    return () => provider as T;
  }
  throw new TypeError(
    "Non-primitive default values must be provided via a factory function () => value",
  );
}
