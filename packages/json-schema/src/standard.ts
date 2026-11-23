import type { Codec, InferEncoded, InferValue, StandardSchemaV1 } from "modvia";
import { toJsonSchema } from "./converter.ts";
import type { StandardJSONSchemaV1, ToJsonSchemaOptions, WithJsonSchema } from "./types.ts";

/**
 * 为任意 Modvia Codec 或 Model 挂载 StandardJSONSchemaV1（`~standard.jsonSchema`）能力
 *
 * @description 保留原实例的全部方法、属性与内部符号标识，使其可继续参与容器嵌套、模型组合及直接传入 OpenAPI / AI Tool 框架
 */
export function withJsonSchema<C extends Codec<unknown, unknown>>(codec: C): WithJsonSchema<C> {
  if (
    typeof codec !== "object" ||
    codec === null ||
    typeof codec["~standard"] !== "object" ||
    codec["~standard"] === null
  ) {
    throw new TypeError("withJsonSchema requires a standard Modvia Codec or Model instance");
  }

  const baseStandard = codec["~standard"] as StandardSchemaV1.Props<InferEncoded<C>, InferValue<C>>;

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

  const combinedStandard = Object.freeze({
    ...baseStandard,
    jsonSchema: jsonSchemaConverter,
  });

  const descriptors: PropertyDescriptorMap = Object.getOwnPropertyDescriptors(codec);
  descriptors["~standard"] = {
    value: combinedStandard,
    enumerable: true,
    configurable: false,
    writable: false,
  };
  let wrapped: unknown;
  if ("brand" in descriptors) {
    descriptors.brand = {
      value: () => wrapped,
      enumerable: true,
      configurable: false,
      writable: false,
    };
  }

  wrapped = Object.freeze(Object.create(Object.getPrototypeOf(codec), descriptors));
  return wrapped as WithJsonSchema<C>;
}
