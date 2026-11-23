import {
  Alias,
  arrayOf,
  bigint,
  boolean,
  Codec,
  int,
  isoDateTime,
  literal,
  Model,
  number,
  oneOf,
  recordOf,
  string,
  tupleOf,
  unknown,
} from "modvia";
import { email, jsonOf, url, uuid } from "modvia/formats";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { toJsonSchema, withJsonSchema, type StandardJSONSchemaV1 } from "../src/index.ts";

describe("@modvia/json-schema — toJsonSchema & withJsonSchema", () => {
  test("按 DTO 与 Data 双视角导出模型 Schema，自动同步 alias 键名、默认值必填性、description 与格式元数据", () => {
    const User = Model.define({
      alias: Alias.snakeCase,
      fields: {
        userId: uuid().describe("Primary user UUID"),
        emailAddress: email().trim().lowercase(),
        username: string()
          .trim()
          .minLength(3)
          .maxLength(20)
          .pattern(/^[a-z0-9_]+$/),
        age: int().nonNegative().max(150).optional().describe("Age in years"),
        score: number().nonNegative().max(100).default(60),
        role: oneOf("admin", "member").alias("account_role"),
        active: boolean(),
        nickname: string().nullable(),
        createdAt: isoDateTime(),
        extraMeta: unknown().optional(),
      },
    }).describe("User profile contract");

    const dtoSchema = toJsonSchema(User);
    expect(dtoSchema).toStrictEqual({
      $schema: "https://json-schema.org/draft/2020-12/schema",
      type: "object",
      description: "User profile contract",
      properties: {
        user_id: { type: "string", format: "uuid", description: "Primary user UUID" },
        email_address: { type: "string", format: "email", maxLength: 254 },
        username: {
          type: "string",
          minLength: 3,
          maxLength: 20,
          pattern: "^[a-z0-9_]+$",
        },
        age: { type: "integer", minimum: 0, maximum: 150, description: "Age in years" },
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
      description: "User profile contract",
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
    const TextBlock = Model.define({
      fields: {
        kind: literal("text").alias("block_type"),
        body: string().nonEmpty(),
      },
    });
    const LinkBlock = Model.define({
      fields: {
        kind: literal("link").alias("block_type"),
        href: url().https().nullable(),
      },
    });
    const Block = Model.union("kind", [TextBlock, LinkBlock]);

    // OpenAPI 3.0：无 $schema，nullable 折叠为 nullable: true，Model.union 带 discriminator
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
    const Pair = tupleOf(string(), int().min(1));
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

    // 数组长度、开区间数值及 OpenAPI 3.0 exclusiveMinimum 布尔转换
    const Bounded = arrayOf(string()).nonEmpty().maxLength(5);
    expect(toJsonSchema(Bounded, { includeSchemaUri: false })).toStrictEqual({
      type: "array",
      items: { type: "string" },
      minItems: 1,
      maxItems: 5,
    });

    const OpenRatio = number().positive().lt(1);
    expect(toJsonSchema(OpenRatio, { includeSchemaUri: false })).toStrictEqual({
      type: "number",
      exclusiveMinimum: 0,
      exclusiveMaximum: 1,
    });
    expect(toJsonSchema(OpenRatio, { target: "openapi-3.0" })).toStrictEqual({
      type: "number",
      minimum: 0,
      exclusiveMinimum: true,
      maximum: 1,
      exclusiveMaximum: true,
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

    const InvertedIso = Codec.invert(isoDateTime());
    expect(toJsonSchema(InvertedIso, { side: "data", includeSchemaUri: false })).toStrictEqual({
      type: "string",
      format: "date-time",
    });

    const Flex = Codec.union(int(), literal("auto", false));
    expect(toJsonSchema(Flex, { includeSchemaUri: false })).toStrictEqual({
      anyOf: [{ type: "integer" }, { enum: ["auto", false] }],
    });

    // 标量 .fromString() 在 DTO 侧输出字符串 Schema，在 Data 侧输出数值 Schema
    const PortText = int().positive().max(65535).fromString();
    expect(toJsonSchema(PortText, { side: "dto", includeSchemaUri: false })).toStrictEqual({
      type: "string",
      pattern: "^[+-]?\\d+$",
    });
    expect(toJsonSchema(PortText, { side: "data", includeSchemaUri: false })).toStrictEqual({
      type: "integer",
      exclusiveMinimum: 0,
      maximum: 65535,
    });
    expect(toJsonSchema(PortText, { side: "data", target: "openapi-3.0" })).toStrictEqual({
      type: "integer",
      minimum: 0,
      exclusiveMinimum: true,
      maximum: 65535,
    });

    // 原生 bigint 在 strict 模式下报 TypeError，切换 .fromString() 后在 DTO 侧可无损输出字符串 Schema，Data 侧诚实反映 bigint 非 JSON 原语
    expect(() => toJsonSchema(bigint(), { strict: true })).toThrow(TypeError);
    expect(
      toJsonSchema(bigint().positive().fromString(), { strict: true, includeSchemaUri: false }),
    ).toStrictEqual({
      type: "string",
      pattern: "^[+-]?\\d+$",
    });
    expect(
      toJsonSchema(bigint().positive().fromString(), { side: "data", includeSchemaUri: false }),
    ).toStrictEqual({});
    expect(() =>
      toJsonSchema(bigint().positive().fromString(), { side: "data", strict: true }),
    ).toThrow(TypeError);
  });

  test("自动检测 Codec.lazy 自引用递归环并提升为 $defs / definitions 引用", () => {
    interface CategoryData {
      readonly id: string;
      readonly children: readonly CategoryData[];
    }
    interface CategoryDTO {
      id: string;
      sub_items: CategoryDTO[];
    }

    const Category: Model<CategoryData, CategoryDTO> = Model.define({
      fields: {
        id: string(),
        children: arrayOf(Codec.lazy(() => Category)).alias("sub_items"),
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

    // 自引用模型通过 .nullable() 递归引用时仍精确命中同一根模型定义，不发生二次展开
    interface LinkedNodeData {
      readonly id: string;
      readonly next: LinkedNodeData | null;
    }
    interface LinkedNodeDTO {
      id: string;
      next: LinkedNodeDTO | null;
    }
    const LinkedNode: Model<LinkedNodeData, LinkedNodeDTO> = Model.define({
      fields: {
        id: string(),
        next: Codec.lazy(() => LinkedNode.nullable()),
      },
    });
    expect(toJsonSchema(LinkedNode, { includeSchemaUri: false })).toStrictEqual({
      $ref: "#/$defs/def_0",
      $defs: {
        def_0: {
          type: "object",
          properties: {
            id: { type: "string" },
            next: {
              anyOf: [{ $ref: "#/$defs/def_0" }, { type: "null" }],
            },
          },
          required: ["id", "next"],
          additionalProperties: false,
        },
      },
    });
  });

  test("withJsonSchema 挂载 StandardJSONSchemaV1 协议并完整保留模型能力与 strict 校验", () => {
    const Task = withJsonSchema(
      Model.define({
        alias: Alias.snakeCase,
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
    expect(Task.brand<"VerifiedTask">()).toBe(Task);
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

    // Model.strict() 在显式传入 additionalProperties: true 时仍强制输出 additionalProperties: false
    const LooseModel = Model.define({ fields: { a: string() } });
    const StrictModel = LooseModel.strict();
    expect(
      toJsonSchema(LooseModel, { additionalProperties: true, includeSchemaUri: false }),
    ).toMatchObject({ additionalProperties: true });
    expect(
      toJsonSchema(StrictModel, { additionalProperties: true, includeSchemaUri: false }),
    ).toMatchObject({ additionalProperties: false });

    // strict 模式下拒绝无元数据的不透明自定义 Codec
    const Opaque = Codec.define<number, string>({
      decode: (s) => Number(s),
      encode: (n) => String(n),
    });
    expect(toJsonSchema(Opaque, { includeSchemaUri: false })).toStrictEqual({});
    expect(() => toJsonSchema(Opaque, { strict: true })).toThrow(TypeError);
  });
});
