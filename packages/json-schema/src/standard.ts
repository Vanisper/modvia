import { Codec, type StandardCodec } from "modvia";
import { toJsonSchema } from "./converter.ts";
import type { StandardJSONSchemaV1, ToJsonSchemaOptions, WithJsonSchema } from "./types.ts";

/**
 * 为任意 Modvia Codec 或 Model 挂载 StandardJSONSchemaV1（`~standard.jsonSchema`）能力
 *
 * @description 经 Codec.extendStandard 派生同构实例：保留全部方法、结构描述符与执行行为，可继续参与容器嵌套、模型组合及直接传入 OpenAPI / AI Tool 框架；
 * 在其上继续派生的新定义不继承 jsonSchema 扩展（其 Schema 已不同于原定义）
 */
export function withJsonSchema<C extends StandardCodec>(codec: C): WithJsonSchema<C> {
  if (
    typeof codec !== "object" ||
    codec === null ||
    typeof codec["~standard"] !== "object" ||
    codec["~standard"] === null
  ) {
    throw new TypeError("withJsonSchema requires a standard Modvia Codec or Model instance");
  }

  const jsonSchemaConverter: StandardJSONSchemaV1.Converter = Object.freeze({
    input(options: StandardJSONSchemaV1.Options): Record<string, unknown> {
      return toJsonSchema(codec, {
        ...(options.libraryOptions as ToJsonSchemaOptions | undefined),
        side: "dto",
        target: options.target,
      });
    },
    output(options: StandardJSONSchemaV1.Options): Record<string, unknown> {
      return toJsonSchema(codec, {
        ...(options.libraryOptions as ToJsonSchemaOptions | undefined),
        side: "data",
        target: options.target,
      });
    },
  });

  return Codec.extendStandard(codec, {
    jsonSchema: jsonSchemaConverter,
  }) as unknown as WithJsonSchema<C>;
}
