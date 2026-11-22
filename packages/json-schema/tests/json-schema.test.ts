import {
  arrayOf,
  boolean,
  defineCodec,
  defineModel,
  int,
  invert,
  isoDateTime,
  lazy,
  literal,
  number,
  oneOf,
  recordOf,
  snakeCase,
  string,
  taggedUnion,
  tupleOf,
  unionOf,
  unknown,
  type Model,
} from "modvia";
import { email, jsonOf, url, uuid } from "modvia/formats";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { toJsonSchema, withJsonSchema, type StandardJSONSchemaV1 } from "../src/index.ts";

describe("@modvia/json-schema — toJsonSchema & withJsonSchema", () => {
  test("按 DTO 与 Data 双视角导出模型 Schema，自动同步 alias 键名、默认值必填性与格式元数据", () => {
    const User = defineModel({
      alias: snakeCase,
      fields: {
        userId: uuid(),
        emailAddress: email({ trim: true, lowercase: true }),
        username: string({ trim: true, minLength: 3, maxLength: 20, pattern: /^[a-z0-9_]+$/ }),
        age: int({ min: 0, max: 150 }).optional(),
        score: number({ min: 0, max: 100 }).default(60),
        role: oneOf("admin", "member").alias("account_role"),
        active: boolean(),
        nickname: string().nullable(),
        createdAt: isoDateTime(),
        extraMeta: unknown().optional(),
      },
    });

    const dtoSchema = toJsonSchema(User);
    expect(dtoSchema).toStrictEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      properties: {
        user_id: { type: "string", format: "uuid" },
        email_address: { type: "string", format: "email", maxLength: 254 },
        username: {
          type: "string",
          minLength: 3,
          maxLength: 20,
          pattern: "^[a-z0-9_]+$",
        },
        age: { type: "integer", minimum: 0, maximum: 150 },
        score: { type: "number", minimum: 0, maximum: 100 },
        account_role: { type: "string", enum: ["admin", "member"] },
        active: { type: "boolean" },
        nickname: {
          anyOf: [{ type: "string" }, { type: "null" }],
        },
        created_at: { type: "string", format: "date-time" },
        extra_meta: {},
      },
      // score 带 default，DTO 入参侧可省略，故不在 required 中
      required: [
        "user_id",
        "email_address",
        "username",
        "account_role",
        "active",
        "nickname",
        "created_at",
      ],
      additionalProperties: false,
    });

    const dataSchema = toJsonSchema(User, { side: "data", includeSchemaUri: false });
    expect(dataSchema).toMatchObject({
      type: "object",
      // Data 侧使用内部属性名，且带 default 的 score 在业务对象上始终存在（列入 required）
      required: [
        "userId",
        "emailAddress",
        "username",
        "score",
        "role",
        "active",
        "nickname",
        "createdAt",
      ],
    });
  });

  test("支持容器（arrayOf/tupleOf/recordOf）、多态联合、双向管道及 OpenAPI 3.0 / Draft-07 规范差异", () => {
    const TextBlock = defineModel({
      fields: {
        kind: literal("text").alias("block_type"),
        body: string({ minLength: 1 }),
      },
    });
    const LinkBlock = defineModel({
      fields: {
        kind: literal("link").alias("block_type"),
        href: url({ protocols: ["https"] }).nullable(),
      },
    });
    const Block = taggedUnion("kind", [TextBlock, LinkBlock]);

    // OpenAPI 3.0：无 $schema，nullable 折叠为 nullable: true，taggedUnion 带 discriminator
    const openApiSchema = toJsonSchema(Block, { target: "openapi-3.0" });
    expect(openApiSchema).toStrictEqual({
      oneOf: [
        {
          type: "object",
          properties: {
            block_type: { type: "string", enum: ["text"] },
            body: { type: "string", minLength: 1 },
          },
          required: ["block_type", "body"],
          additionalProperties: false,
        },
        {
          type: "object",
          properties: {
            block_type: { type: "string", enum: ["link"] },
            href: { type: "string", format: "uri", nullable: true },
          },
          required: ["block_type", "href"],
          additionalProperties: false,
        },
      ],
      discriminator: { propertyName: "block_type" },
    });

    // Draft-07 与 Draft-2020-12 在 tuple 上的差异
    const Pair = tupleOf(string(), int({ min: 1 }));
    expect(toJsonSchema(Pair, { includeSchemaUri: false })).toStrictEqual({
      type: "array",
      prefixItems: [{ type: "string" }, { type: "integer", minimum: 1 }],
      minItems: 2,
      maxItems: 2,
    });
    expect(toJsonSchema(Pair, { target: "draft-07" })).toStrictEqual({
      $schema: "http://json-schema.org/draft-07/schema#",
      type: "array",
      items: [{ type: "string" }, { type: "integer", minimum: 1 }],
      minItems: 2,
      maxItems: 2,
      additionalItems: false,
    });

    // 数组长度、字典与管道/反转双视角
    const Bounded = arrayOf(string(), { minLength: 1, maxLength: 5 });
    expect(toJsonSchema(Bounded, { includeSchemaUri: false })).toStrictEqual({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5,
    });

    const LocaleMap = recordOf(oneOf("zh", "en"), string());
    expect(toJsonSchema(LocaleMap, { includeSchemaUri: false })).toStrictEqual({
      type: "object",
      propertyNames: { type: "string", enum: ["zh", "en"] },
      additionalProperties: { type: "string" },
    });

    const JsonTextBlock = jsonOf(TextBlock);
    expect(toJsonSchema(JsonTextBlock, { side: "dto", includeSchemaUri: false })).toStrictEqual({
      type: "string",
    });
    expect(toJsonSchema(JsonTextBlock, { side: "data", includeSchemaUri: false })).toMatchObject({
      type: "object",
      required: ["kind", "body"],
    });

    const InvertedIso = invert(isoDateTime());
    expect(toJsonSchema(InvertedIso, { side: "data", includeSchemaUri: false })).toStrictEqual({
      type: "string",
      format: "date-time",
    });

    const Flex = unionOf(int(), literal("auto", false));
    expect(toJsonSchema(Flex, { includeSchemaUri: false })).toStrictEqual({
      anyOf: [{ type: "integer" }, { enum: ["auto", false] }],
    });
  });

  test("自动检测 lazy 自引用递归环并提升为 $defs / definitions 引用", () => {
    interface CategoryData {
      readonly id: string;
      readonly children: readonly CategoryData[];
    }
    interface CategoryDTO {
      id: string;
      sub_items: CategoryDTO[];
    }

    const Category: Model<CategoryData, CategoryDTO> = defineModel({
      fields: {
        id: string(),
        children: arrayOf(lazy(() => Category)).alias("sub_items"),
      },
    });

    expect(toJsonSchema(Category, { includeSchemaUri: false })).toStrictEqual({
      $ref: "#/$defs/def_0",
      $defs: {
        def_0: {
          type: "object",
          properties: {
            id: { type: "string" },
            sub_items: {
              type: "array",
              items: { $ref: "#/$defs/def_0" },
            },
          },
          required: ["id", "sub_items"],
          additionalProperties: false,
        },
      },
    });

    expect(toJsonSchema(Category, { target: "draft-07", includeSchemaUri: false })).toMatchObject({
      $ref: "#/definitions/def_0",
      definitions: {
        def_0: {
          type: "object",
          properties: {
            sub_items: { items: { $ref: "#/definitions/def_0" } },
          },
        },
      },
    });
  });

  test("withJsonSchema 挂载 StandardJSONSchemaV1 协议并完整保留模型能力与 strict 校验", () => {
    const Task = withJsonSchema(
      defineModel({
        alias: snakeCase,
        fields: {
          taskId: uuid(),
          done: boolean().default(false),
        },
      }),
    );

    function acceptStandardJson<I, O>(schema: StandardJSONSchemaV1<I, O>) {
      return schema["~standard"].jsonSchema;
    }

    const converter = acceptStandardJson(Task);
    expectTypeOf(Task.parse({ task_id: "550e8400-e29b-41d4-a716-446655440000" })).toEqualTypeOf<{
      readonly taskId: string;
      readonly done: boolean;
    }>();

    expect(converter.input({ target: "draft-2020-12" })).toMatchObject({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      required: ["task_id"],
    });
    expect(converter.output({ target: "draft-2020-12" })).toMatchObject({
      type: "object",
      required: ["taskId", "done"],
    });
    expect(() => converter.input({ target: "draft-04" })).toThrow(RangeError);

    // 包装后的实例仍可继续正常解析、嵌套进 arrayOf 与调用模型派生方法
    expect(
      arrayOf(Task).parse([{ task_id: "550e8400-e29b-41d4-a716-446655440000" }]),
    ).toStrictEqual([{ taskId: "550e8400-e29b-41d4-a716-446655440000", done: false }]);

    // strict 模式下拒绝无元数据的不透明自定义 Codec
    const Opaque = defineCodec<number, string>({
      decode: (s) => Number(s),
      encode: (n) => String(n),
    });
    expect(toJsonSchema(Opaque, { includeSchemaUri: false })).toStrictEqual({});
    expect(() => toJsonSchema(Opaque, { strict: true })).toThrow(TypeError);
  });
});
