import type { Codec, Field, FieldPresence, Model } from "./types.ts";

export type FieldRecord = Readonly<Record<string, Codec<unknown, unknown>>>;

type AnyField = Field<unknown, unknown, string | undefined, FieldPresence>;
type SourceOf<C, Key extends PropertyKey> =
  C extends Field<infer _T, infer _E, infer Source, infer _P>
    ? Source extends string
      ? Source
      : Key
    : Key;

// 别名由运行时选择时，DTO 里的每个候选键都可能缺失
type VariableKey<Key, All = Key> = string extends All
  ? true
  : Key extends unknown
    ? [All] extends [Key]
      ? false
      : true
    : never;
type CanOmit<C, Key extends PropertyKey, Side> = "optional" extends Extract<C, AnyField>["presence"]
  ? true
  : Side extends "dto"
    ? VariableKey<SourceOf<C, Key>>
    : false;

// 逐个字段表推导必填与可选键，保留联合分支和索引签名中的已知字段
type FieldLayout<Fields, Side extends "data" | "dto"> = Fields extends unknown
  ? { [K in keyof Fields as CanOmit<Fields[K], K, Side> extends true ? never : K]: Fields[K] } & {
      [K in keyof Fields as CanOmit<Fields[K], K, Side> extends true ? K : never]?: Fields[K];
    }
  : never;

type ValueOf<C> = C extends Codec<infer Value, infer _Encoded> ? Value : never;
type EncodedOf<C> = C extends Codec<infer _Value, infer Encoded> ? Encoded : never;

type DataOf<Fields> = {
  readonly [Key in keyof Fields]: ValueOf<Fields[Key]>;
};

type DTOOf<Fields> = {
  [Key in keyof Fields as SourceOf<NonNullable<Fields[Key]>, Key>]: EncodedOf<Fields[Key]>;
};

export type ModelOf<Fields extends FieldRecord> = Model<
  DataOf<FieldLayout<Fields, "data">>,
  DTOOf<FieldLayout<Fields, "dto">>
>;
