import type { Codec, CodecLike, Field, FieldPresence } from "../../codec/core/types.ts";

export type FieldRecord = Readonly<Record<string, CodecLike<unknown, unknown>>>;

export type MergeFields<Base extends FieldRecord, Extra extends FieldRecord> = Omit<
  Base,
  keyof Extra
> &
  Extra;

/** 从声明字段构造业务对象，并将业务输出编码回外部 DTO */
export interface Model<
  Data,
  DTO,
  Out extends Data = Data,
  Fields extends FieldRecord = Record<never, never>,
> extends Codec<Out, DTO> {
  /** 模型声明的只读字段描述符表 */
  readonly fields: Readonly<Fields>;
  /** 挑选指定字段派生子模型，保留原字段的外部别名与缺省规则 */
  pick<const Key extends Exclude<keyof Fields, symbol>>(
    this: void,
    ...keys: readonly Key[]
  ): ModelOf<Pick<Fields, Key>>;
  /** 剔除指定字段派生子模型，保留其余字段的外部别名与缺省规则 */
  omit<const Key extends Exclude<keyof Fields, symbol>>(
    this: void,
    ...keys: readonly Key[]
  ): ModelOf<Omit<Fields, Key>>;
  /** 追加或覆写字段派生新模型，定义期重新检查外部键唯一性 */
  extend<const Extra extends FieldRecord>(
    this: void,
    fields: Extra,
  ): ModelOf<MergeFields<Fields, Extra>>;
  /** 用新工厂替换实例构造步骤，工厂接收完整校验后的基础字段数据 */
  withFactory<Next extends Data>(
    this: void,
    factory: (data: Data) => Next,
  ): Model<Data, DTO, Next, Fields>;
}

/** 具备指定判别字段的模型分支契约，供 taggedUnion 编译期校验分支结构 */
export interface TaggedModelLike<
  Discriminator extends string,
  Out = Record<Discriminator, unknown>,
  DTO = unknown,
> extends CodecLike<Out, DTO> {
  readonly [Symbol.toStringTag]: "modvia.Codec";
  readonly fields: Readonly<Record<Discriminator, CodecLike<unknown, unknown>>>;
}

export type InferData<M> =
  M extends Model<infer Data, infer _DTO, infer _Out, infer _Fields> ? Data : never;

export type InferDTO<M> =
  M extends Model<infer _Data, infer DTO, infer _Out, infer _Fields> ? DTO : never;

export type InferModel<M> =
  M extends Model<infer _Data, infer _DTO, infer Out, infer _Fields> ? Out : never;

type AnyField = Field<unknown, unknown, string | undefined, FieldPresence>;

type SourceOf<C, Key extends PropertyKey> =
  C extends Field<infer _T, infer _E, infer Source, infer _P>
    ? Source extends string
      ? Source
      : Key
    : Key;

// 别名由运行时分支决定时，DTO 中的各个候选键均可能省略
type VariableKey<Key extends PropertyKey, All = Key> = Key extends unknown
  ? {} extends Record<Key, unknown>
    ? true
    : [All] extends [Key]
      ? false
      : true
  : never;

type CanOmit<C, Key extends PropertyKey, Side> = "optional" extends Extract<C, AnyField>["presence"]
  ? true
  : Side extends "dto"
    ? VariableKey<SourceOf<C, Key>>
    : false;

// 逐个字段表推导必填与可选键，保留联合分支与索引签名中的已知字段
type FieldLayout<Fields, Side extends "data" | "dto"> = Fields extends unknown
  ? {
      [
        K in keyof Fields as CanOmit<Fields[K], K, Side> extends true ? never : Exclude<K, symbol>
      ]: Fields[K];
    } & {
      [
        K in keyof Fields as CanOmit<Fields[K], K, Side> extends true ? Exclude<K, symbol> : never
      ]?: Fields[K];
    }
  : never;

type ValueOf<C> = C extends CodecLike<infer Value, infer _Encoded> ? Value : never;

// 动态别名推导为索引签名时，按具体键读取可能得到 undefined
type EncodedOf<C> =
  C extends CodecLike<infer _Value, infer Encoded> ? Encoded : Extract<C, undefined>;

type DataOf<Fields> = {
  readonly [Key in keyof Fields]: ValueOf<Fields[Key]>;
};

type DTOOf<Fields> = {
  [Key in keyof Fields as SourceOf<NonNullable<Fields[Key]>, Key>]: EncodedOf<Fields[Key]>;
};

export type ModelOf<Fields extends FieldRecord> = Model<
  DataOf<FieldLayout<Fields, "data">>,
  DTOOf<FieldLayout<Fields, "dto">>,
  DataOf<FieldLayout<Fields, "data">>,
  Fields
>;
