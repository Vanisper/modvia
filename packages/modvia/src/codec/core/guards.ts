import { isPlainObject } from "../../shared/object.ts";
import { isPrimitiveLiteral } from "../../shared/value.ts";
import { isFieldLike } from "./field.ts";
import type { CodecLike, FieldLiteral } from "./types.ts";

/**
 * 定义期参数守卫：统一遵循「JS 类型不符抛 TypeError，类型正确但取值非法或冲突抛 RangeError」
 */

export function assertDescription(description: unknown): asserts description is string {
  if (typeof description !== "string") {
    throw new TypeError("Description must be a string");
  }
}

export function assertSource(source: unknown): asserts source is string {
  if (typeof source !== "string") {
    throw new TypeError("Field source must be a string");
  }
}

export function assertLiterals(
  values: readonly unknown[],
): asserts values is readonly FieldLiteral[] {
  if (values.length === 0 || !values.every(isPrimitiveLiteral)) {
    throw new TypeError(
      "or requires at least one string, number, boolean, null, or undefined literal",
    );
  }
}

export function assertFunction(
  value: unknown,
  message: string,
): asserts value is (...args: never[]) => unknown {
  if (typeof value !== "function") {
    throw new TypeError(message);
  }
}

export function assertPlainObject(
  value: unknown,
  message: string,
): asserts value is Record<string, unknown> {
  if (!isPlainObject(value)) {
    throw new TypeError(message);
  }
}

/** 值级容器与组合子只接受值级 Codec，拒绝携带键绑定元数据的 Field */
export function assertValueCodec(
  codec: unknown,
  caller: string,
): asserts codec is CodecLike<unknown, unknown> {
  if (isFieldLike(codec)) {
    throw new TypeError(
      `${caller} accepts a value Codec, not a Field with .alias() or .optional(); apply field modifiers on the outer container or pass field.codec`,
    );
  }
  if (
    typeof codec !== "object" ||
    codec === null ||
    typeof (codec as Partial<CodecLike<unknown, unknown>>).decode !== "function" ||
    typeof (codec as Partial<CodecLike<unknown, unknown>>).encode !== "function"
  ) {
    throw new TypeError(`${caller} requires a valid Codec`);
  }
}
