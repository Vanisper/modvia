export type PathSegment = string | number;

export interface ValidationIssue {
  readonly path: readonly PathSegment[];
  readonly code: string;
  readonly message: string;
}

export type SafeResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly issues?: undefined;
    }
  | {
      readonly ok: false;
      readonly issues: readonly ValidationIssue[];
      readonly value?: undefined;
    };

export interface CodecContext {
  fail(this: void, code: string, message: string): never;
}

/** Standard Schema v1 互操作接口，零运行时依赖对接表单与全栈框架 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (this: void, value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
    readonly value?: undefined;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegmentObject> | undefined;
  }

  export interface PathSegmentObject {
    readonly key: PropertyKey;
  }
}

/** 最小双向转换协议，允许手写对象直接接入容器与模型 */
export interface CodecLike<T, Encoded = T> {
  /** 校验外部输入并返回业务值 */
  decode(this: void, input: unknown): T;
  /** 校验业务值并转换为外部表示 */
  encode(this: void, value: T): Encoded;
}

/** 值级容器接受任意 Codec 或自定义 CodecLike，编译期拒绝带键绑定元数据的 Field */
export type ValueCodecInput<T, Encoded = T> = CodecLike<T, Encoded> & {
  readonly [Symbol.toStringTag]?: "modvia.Codec";
};

export type FieldPresence = "required" | "optional";
export type FieldLiteral = string | number | boolean | null | undefined;

/** 标准双向值编解码器，支持安全解析、字面量豁免与向对象字段跃迁 */
export interface Codec<T, Encoded = T> extends CodecLike<T, Encoded>, StandardSchemaV1<Encoded, T> {
  readonly [Symbol.toStringTag]: "modvia.Codec";
  /** 校验外部输入并返回判别结果，不抛出校验异常 */
  safeDecode(this: void, input: unknown): SafeResult<T>;
  /** 校验业务值并编码，返回判别结果而不抛出校验异常 */
  safeEncode(this: void, value: T): SafeResult<Encoded>;
  /**
   * 将一个或多个显式字面量作为哨兵值加入双向取值范围
   *
   * @description 编解码均先按 Object.is 优先匹配字面量，命中时原样返回
   */
  or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(
    this: void,
    ...values: Literals
  ): Codec<T | Literals[number], Encoded | Literals[number]>;
  /** 允许值为 null，等价于 .or(null) */
  nullable(this: void): Codec<T | null, Encoded | null>;
  /** 指定作为对象字段时的外部键名，跃迁为必填字段描述符 */
  from<NextSource extends string>(
    this: void,
    source: NextSource,
  ): Field<T, Encoded, NextSource, "required">;
  /** 允许父对象省略此键，跃迁为可选字段描述符 */
  optional(this: void): Field<T, Encoded, undefined, "optional">;
}

/** 绑定了外部键名与键缺省规则的对象字段描述符 */
export interface Field<
  T,
  Encoded = T,
  Source extends string | undefined = undefined,
  Presence extends FieldPresence = "required",
>
  extends CodecLike<T, Encoded>, StandardSchemaV1<Encoded, T> {
  readonly [Symbol.toStringTag]: "modvia.Field";
  /** 剥离外部键名与缺省性后的纯值级 Codec */
  readonly codec: Codec<T, Encoded>;
  /** 外部字段名，未指定时沿用模型属性名 */
  readonly source: Source;
  /** 父对象在编解码时是否允许省略此键 */
  readonly presence: Presence;
  /** 校验单个外部值并返回判别结果 */
  safeDecode(this: void, input: unknown): SafeResult<T>;
  /** 校验单个业务值并编码，返回判别结果 */
  safeEncode(this: void, value: T): SafeResult<Encoded>;
  /** 改绑父对象读写此字段时使用的外部键名 */
  from<NextSource extends string>(
    this: void,
    source: NextSource,
  ): Field<T, Encoded, NextSource, Presence>;
  /** 允许父对象省略此键，键存在时仍执行值规则 */
  optional(this: void): Field<T, Encoded, Source, "optional">;
  /** 将字段恢复为父对象必填键 */
  required(this: void): Field<T, Encoded, Source, "required">;
  /** 在保留字段外部名与缺省性的前提下，向值规则追加哨兵字面量 */
  or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(
    this: void,
    ...values: Literals
  ): Field<T | Literals[number], Encoded | Literals[number], Source, Presence>;
  /** 允许字段值为 null，同时保留外部名与缺省性 */
  nullable(this: void): Field<T | null, Encoded | null, Source, Presence>;
}

export type InferValue<C> = C extends CodecLike<infer Value, infer _Encoded> ? Value : never;

export type InferEncoded<C> = C extends CodecLike<infer _Value, infer Encoded> ? Encoded : never;
