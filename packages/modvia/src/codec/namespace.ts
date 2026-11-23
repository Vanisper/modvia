import { defineCodec, field, inspectCodec, isField } from "./core/define.ts";
import type {
  Codec as CodecInterface,
  Field as FieldInterface,
  FieldPresence,
} from "./core/types.ts";
import { invert, lazy, pipe, unionOf } from "./operators/combinators.ts";

/** 标准双向值编解码器契约与元操作命名空间 */
export type Codec<T, Encoded = T> = CodecInterface<T, Encoded>;

export const Codec = Object.freeze({
  define: defineCodec,
  inspect: inspectCodec,
  pipe,
  invert,
  lazy,
  union: unionOf,
});

/** 绑定了外部键别名、缺省规则与属性说明的对象槽位描述符与工具命名空间 */
export type Field<
  T,
  Encoded = T,
  Source extends string | undefined = undefined,
  Presence extends FieldPresence = "required",
> = FieldInterface<T, Encoded, Source, Presence>;

export const Field = Object.freeze({
  of: field,
  is: isField,
});
