import { defineModel } from "./core/define.ts";
import type { FieldRecord, Model as ModelInterface } from "./core/types.ts";
import { taggedUnion } from "./operators/tagged-union.ts";

/** 从声明字段构造业务对象并将业务输出编码回外部 DTO 的领域模型契约与命名空间 */
export type Model<
  Data,
  DTO,
  Out extends Data = Data,
  Fields extends FieldRecord = Record<never, never>,
> = ModelInterface<Data, DTO, Out, Fields>;

export const Model = Object.freeze({
  define: defineModel,
  union: taggedUnion,
});
