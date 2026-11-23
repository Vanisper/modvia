import type { CodecLike, InferEncoded, InferValue, StandardSchemaV1 } from "modvia";

export type JsonSchemaTarget = "draft-2020-12" | "draft-07" | "openapi-3.0";

export type JsonSchemaSide = "dto" | "data";

export type JsonSchemaObject = Record<string, unknown>;

export interface ToJsonSchemaOptions {
  /** 导出契约视角：默认 "dto"（外部传输协议侧，自动应用 alias 键名与编码侧类型），可选 "data"（内部领域数据侧） */
  readonly side?: JsonSchemaSide;
  /** 目标规范版本，默认 "draft-2020-12" */
  readonly target?: JsonSchemaTarget | ({} & string);
  /** 是否在根对象附带 $schema 元标识（openapi-3.0 下始终省略），默认 true */
  readonly includeSchemaUri?: boolean;
  /** 对象模型是否允许未声明的额外属性，默认 false（与 Modvia 剥离未知属性契约一致） */
  readonly additionalProperties?: boolean;
  /** 遇到无静态描述的自定义 Codec 或不可直接 JSON 化的值（如 data 侧 Date / undefined）时是否抛 TypeError，默认 false（回退为 {}） */
  readonly strict?: boolean;
}

/** Standard JSON Schema v1 互操作接口（对接 OpenAPI 生成器、AI Tool Schema 与全栈 RPC 框架） */
export interface StandardJSONSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardJSONSchemaV1.Props<Input, Output>;
}

export declare namespace StandardJSONSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly types?: StandardSchemaV1.Types<Input, Output> | undefined;
    readonly jsonSchema: Converter;
  }

  export interface Converter {
    readonly input: (this: void, options: Options) => Record<string, unknown>;
    readonly output: (this: void, options: Options) => Record<string, unknown>;
  }

  export interface Options {
    readonly target: JsonSchemaTarget | ({} & string);
    readonly libraryOptions?: Record<string, unknown> | undefined;
  }
}

export type WithJsonSchema<C extends CodecLike<unknown, unknown>> = C & {
  readonly "~standard": StandardSchemaV1.Props<InferEncoded<C>, InferValue<C>> &
    StandardJSONSchemaV1.Props<InferEncoded<C>, InferValue<C>>;
};
