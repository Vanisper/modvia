import { createScopedContext, INVALID, isAbortSignal } from "./collector.ts";
import { ValidationError } from "./errors.ts";
import {
  createCodec,
  createField,
  getCodecDescriptor,
  getDefaultResolver,
  isFieldDescriptor,
  isStandardCodec,
  promoteToCodec,
} from "./runtime.ts";
import type {
  Codec,
  CodecContext,
  CodecDescriptor,
  CodecLike,
  CustomCodecMeta,
  Field,
  FieldPresence,
} from "./types.ts";

export interface CodecHandlers<T, Encoded> {
  decode(this: void, input: unknown, context: CodecContext): T;
  encode(this: void, input: unknown, context: CodecContext): Encoded;
  readonly meta?: CustomCodecMeta;
}

/** 通过一对双向转换函数创建标准 Codec，正反两端均须对 unknown 输入做校验并可通过 context 报告问题 */
export function defineCodec<T, Encoded = T>(
  handlers: CodecHandlers<T, Encoded>,
): Codec<T, Encoded> {
  const meta = handlers.meta;
  const descriptor: CodecDescriptor = {
    kind: "custom",
    ...(meta?.format !== undefined ? { format: meta.format } : {}),
    ...(meta?.description !== undefined ? { description: meta.description } : {}),
    ...(meta?.encodedSchema !== undefined ? { encodedSchema: meta.encodedSchema } : {}),
    ...(meta?.decodedSchema !== undefined ? { decodedSchema: meta.decodedSchema } : {}),
  };

  return createCodec<T, Encoded>(
    (input, direction, collector) => {
      const mark = collector.mark();
      const context = createScopedContext(collector);
      try {
        const output =
          direction === "decode"
            ? handlers.decode(input, context)
            : handlers.encode(input, context);
        return collector.mark() > mark ? INVALID : output;
      } catch (error) {
        if (isAbortSignal(error)) {
          return collector.add(error.code, error.message);
        }
        if (ValidationError.is(error)) {
          return collector.addRelativeIssues(error.issues);
        }
        throw error;
      }
    },
    { descriptor },
  );
}

/** 读取任意 Codec、Field、Model 或自定义 CodecLike 的只读结构描述符（Field 自动穿透读取底层值 Codec） */
export function inspectCodec(codec: CodecLike<unknown, unknown>): CodecDescriptor {
  if (
    typeof codec !== "object" ||
    codec === null ||
    typeof codec.decode !== "function" ||
    typeof codec.encode !== "function"
  ) {
    throw new TypeError("inspectCodec requires a valid Codec, Field, or CodecLike object");
  }
  return getCodecDescriptor(codec);
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
  const normalizedPresence: FieldPresence =
    presence === "optional" ? "optional" : presence === "defaulted" ? "defaulted" : "required";
  return createField(
    inner,
    typeof source === "string" ? source : undefined,
    normalizedPresence,
    normalizedPresence === "defaulted" ? getDefaultResolver(input) : undefined,
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
