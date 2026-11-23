# @modvia/json-schema

Modvia 官方双向 JSON Schema 与 OpenAPI 3.0 导出包，原生支持 `StandardJSONSchemaV1` 协议。

基于 Modvia「执行闭包与只读结构描述符分离」架构，核心包在运行时保持零解释器负担，本包通过公开的 `Codec.inspect` 反射契约按需生成外部 DTO 或内部业务数据的标准 Schema。

## 安装

```sh
pnpm add modvia @modvia/json-schema
```

## 快速上手

### 导出外部 DTO 与内部 Data 双视角 Schema

`toJsonSchema` 默认采用 `side: "dto"`，自动将模型的 `alias` 键映射、`.describe()` 文档说明、`isoDateTime()` 字符串格式以及 `.default()` 可选入参规则投影为外部协议 Schema：

```ts
import { toJsonSchema } from "@modvia/json-schema";
import { Alias, int, isoDateTime, Model, oneOf, string } from "modvia";
import { email, uuid } from "modvia/formats";

const User = Model.define({
  alias: Alias.snakeCase,
  fields: {
    userId: uuid().describe("Primary user UUID"),
    contactEmail: email({ trim: true, lowercase: true }),
    username: string({ minLength: 3, maxLength: 20 }),
    role: oneOf("admin", "member").default("member"),
    seatQuota: int({ min: 1, max: 100 }),
    createdAt: isoDateTime(),
  },
}).describe("User profile contract");

// 1. 默认导出外部传输契约（DTO 侧：snake_case 键名、description、date-time 字符串、role 在入参侧非必填）
const dtoSchema = toJsonSchema(User);

// 2. 导出 OpenAPI 3.0 组件 Schema（自动省略 $schema，nullable 折叠为 nullable: true，Model.union 生成 discriminator）
const openApiSchema = toJsonSchema(User, { target: "openapi-3.0" });

// 3. 导出内部领域数据契约（Data 侧：内部驼峰键名，带 default 的字段列入 required）
const dataSchema = toJsonSchema(User, { side: "data" });
```

### 对接 `StandardJSONSchemaV1` 全栈与 AI 工具生态

`withJsonSchema` 在完整保留原 `Codec` / `Model` 全部方法与可组合性的同时，向 `"~standard"` 挂载 `jsonSchema: { input, output }`，可直接接入支持 Standard JSON Schema 的 OpenAPI 路由、RPC 框架与 AI Tool / MCP SDK：

```ts
import { withJsonSchema } from "@modvia/json-schema";

const PublicUser = withJsonSchema(User);

// 框架自动读取入参与出参 JSON Schema
const inputSchema = PublicUser["~standard"].jsonSchema.input({ target: "draft-2020-12" });
const outputSchema = PublicUser["~standard"].jsonSchema.output({ target: "draft-2020-12" });

// 原模型的解析、编码与派生能力原样保留
const parsed = PublicUser.parse(rawPayload);
```

## 特性与配置项

- **多规范版本目标（`target`）**：
  - `"draft-2020-12"`（默认）：元组使用 `prefixItems`，递归定义置于 `$defs`。
  - `"draft-07"`：元组使用 `items` 数组配合 `additionalItems: false`，递归定义置于 `definitions`。
  - `"openapi-3.0"`：自动省略顶层 `$schema`，单类型 `.nullable()` 折叠为 `nullable: true`，`Model.union` 自动生成 `discriminator: { propertyName }`。
- **自引用递归环检测**：通过 `Codec.lazy(() => Model)` 定义的树形或图状模型在遇到真实引用环时自动提升至 `$defs` / `definitions` 并输出 `$ref`，非递归复用的子模型保持内联展开。
- **文档说明与严格对象边界**：`Codec`、`Field` 与 `Model` 上的 `.describe(text)` 自动输出为 `"description"`；经 `Model.strict()` 派生的模型始终强制输出 `additionalProperties: false`。
- **自定义原语元数据（`meta`）与严格模式（`strict`）**：自定义 `Codec.define` 可通过 `meta: { description, encodedSchema, decodedSchema }` 声明双端 Schema 片段；开启 `strict: true` 时，遇到未声明静态描述的不透明自定义规则或无法直接 JSON 化的类型将立即抛出 `TypeError`。
