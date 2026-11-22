import { isAbortSignal, sharedContext } from "./collector.ts";
import { isValidationError } from "./errors.ts";
import {
  createCodec,
  createField,
  isFieldDescriptor,
  isStandardCodec,
  promoteToCodec,
} from "./runtime.ts";
import type { Codec, CodecContext, CodecLike, Field, FieldPresence } from "./types.ts";

export interface CodecHandlers<T, Encoded> {
  decode(this: void, input: unknown, context: CodecContext): T;
  encode(this: void, value: T, context: CodecContext): Encoded;
}

/** 通过一对双向转换函数创建标准 Codec，两端均可通过 context.fail 报告校验失败 */
export function defineCodec<T, Encoded = T>(
  handlers: CodecHandlers<T, Encoded>,
): Codec<T, Encoded> {
  return createCodec<T, Encoded>((input, direction, collector) => {
    try {
      return direction === "decode"
        ? handlers.decode(input, sharedContext)
        : handlers.encode(input as T, sharedContext);
    } catch (error) {
      if (isAbortSignal(error)) {
        return collector.add(error.code, error.message);
      }
      if (isValidationError(error)) {
        return collector.addRelativeIssues(error.issues);
      }
      throw error;
    }
  });
}

/** 包装已有字段并保留外部键名与缺省性 */
export function field<
  T,
  Encoded,
  Source extends string | undefined,
  Presence extends FieldPresence = "required",
>(input: Field<T, Encoded, Source, Presence>): Field<T, Encoded, Source, Presence>;
/** 将任意 Codec 或自定义 CodecLike 转为字段描述符 */
export function field<T, Encoded>(input: CodecLike<T, Encoded>): Field<T, Encoded>;
export function field<T, Encoded>(
  input: CodecLike<T, Encoded>,
): Field<T, Encoded, string | undefined, FieldPresence> {
  if (!isField(input)) {
    return createField(promoteToCodec(input), undefined, "required");
  }
  const { source, presence } = input;
  const inner = isStandardCodec(input.codec) ? input.codec : promoteToCodec(input);
  return createField(
    inner,
    typeof source === "string" ? source : undefined,
    presence === "optional" ? "optional" : "required",
  );
}

/** 判断目标值是否为带外部键名与缺省性元数据的 Field 描述符 */
export function isField<T, Encoded>(
  value: CodecLike<T, Encoded>,
): value is Field<T, Encoded, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is Field<unknown, unknown, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is Field<unknown, unknown, string | undefined, FieldPresence> {
  return isFieldDescriptor(value);
}
