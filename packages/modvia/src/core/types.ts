export type PathSegment = string | number;

export interface ModelIssue {
  readonly path: readonly PathSegment[];
  readonly code: string;
  readonly message: string;
}

export interface CodecContext {
  fail(code: string, message: string): never;
}

/** 业务值与外部表示之间的双向转换契约 */
export interface Codec<T, Encoded> {
  /** 校验外部输入并返回业务值 */
  decode(input: unknown): T;
  /** 将业务值转换为外部表示 */
  encode(value: T): Encoded;
}

export type FieldPresence = "required" | "optional";
export type FieldLiteral = string | number | boolean | null | undefined;

/** 可独立编解码的字段声明，每次修饰都返回派生字段 */
export interface Field<
  T,
  Encoded,
  Source extends string | undefined = undefined,
  Presence extends FieldPresence = "required",
> extends Codec<T, Encoded> {
  /** 外部字段名，未指定时沿用模型字段名 */
  readonly source: Source;
  /** 父对象在编解码时是否允许省略此键 */
  readonly presence: Presence;
  /** 指定父对象读写此字段时使用的外部名 */
  from<NextSource extends string>(source: NextSource): Field<T, Encoded, NextSource, Presence>;
  /**
   * 将一个显式字面量加入业务值和外部表示的取值范围
   *
   * @description 编解码均先用 Object.is 匹配该值，命中时原样返回
   */
  or<const Literal extends FieldLiteral>(
    value: Literal,
  ): Field<T | Literal, Encoded | Literal, Source, Presence>;
  /** 允许父对象省略此键，键存在时仍按原值规则编解码 */
  optional(): Field<T, Encoded, Source, "optional">;
}

/** 从声明字段构造对象，并将业务输出编码回 DTO */
export interface Model<Data, DTO, Out extends Data = Data> extends Codec<Out, DTO> {
  /** 用新工厂替换构造步骤，工厂接收完整的基础字段数据 */
  withFactory<Next extends Data>(factory: (data: Data) => Next): Model<Data, DTO, Next>;
}

export type InferData<M> = M extends Model<infer Data, infer _DTO, infer _Out> ? Data : never;

export type InferDTO<M> = M extends Model<infer _Data, infer DTO, infer _Out> ? DTO : never;

export type InferModel<M> = M extends Model<infer _Data, infer _DTO, infer Out> ? Out : never;
