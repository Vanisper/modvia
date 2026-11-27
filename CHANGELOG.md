# Changelog

本文件记录 Modvia 工作区各公开包（`modvia`、`@modvia/json-schema`、`@modvia/zod`）的版本演进，由 [release-please](https://github.com/googleapis/release-please) 基于 Conventional Commits 自动维护。

## [0.1.0](https://github.com/Vanisper/modvia/releases/tag/v0.1.0) (2026-11-27)

首次公开发布，推出零运行时依赖的核心编解码与领域模型包 `modvia`，以及两个独立生态扩展包 `@modvia/json-schema` 与 `@modvia/zod`。

### `modvia`

- **分层多入口与主体命名空间**：提供 `modvia`（完整主入口）、`modvia/codec`（值级双向编解码底座）与 `modvia/formats`（按需 Tree-shaking 领域格式与 JSON 文本原语）三个纯 ESM 入口；元操作按主体组织为 `Model`、`Codec`、`Field`、`Alias` 与 `ValidationError`，零运行时依赖。
- **2×2 执行矩阵与 Standard Schema**：所有值级 `Codec` 与 `Model` 统一提供动态边界接口 `parse` / `dump`、强契约对称接口 `decode` / `encode`（均配备零异常 `safe*` 变体），并原生实现 `StandardSchemaV1`（`~standard`）。
- **编解码内核与组合算子**：支持无状态与状态化自定义链式方法的 `Codec.define`，支持 `.refine()`、`.check()`、`.normalize()`、`.brand()`、`.or()`、`.nullable()`、`.describe()` 不可变链式派生，以及 `Codec.pipe`、`Codec.invert`、`Codec.lazy`、`Codec.union`、`Codec.inspect` 与 `Codec.extendStandard`。
- **原始标量与容器**：提供 `string`、`number`、`int`、`bigint`、`boolean`、`literal`、`unknown`、`isoDateTime`、`arrayOf`、`tupleOf` 与 `recordOf`；数值与布尔标量内建 `.fromString()` 外部字符串介质切换与全序区间约束，容器与字符串共享离散长度约束。
- **领域模型层**：提供 `Model.define` 与 `Model.union` 多态分发，支持批量外部键命名策略（`Alias.snakeCase`、`Alias.kebabCase`、`Alias.define`）、字段修饰（`.alias()` / `.optional()` / `.required()` / `.default()`）、不可变结构派生（`pick` / `omit` / `partial` / `extend` / `strict`）、`withFactory` class 实例构造与原型链公开 getter 投影。
- **领域格式与 JSON 文本原语（`modvia/formats`）**：提供 `uuid`、`email`、`url`、`ipv4`、`ipv6`、`isoDate`、`isoTime`、`jsonString` 与 `jsonOf`。
- **三层互斥错误码目录**：提供编译期联合 `BuiltinIssueCode` / `IssueCode`（类型层 `type.*`、文本格式层 `format.*`、值约束层 `<kind>.<rule>`）与冻结的结构化 `issue.params`。

### `@modvia/json-schema`

- **双视角多目标 Schema 导出**：提供 `toJsonSchema`，支持 `side: "dto" | "data"` 双视角与 `draft-2020-12`、`draft-07`、`openapi-3.0` 目标，覆盖自引用环检测（`$defs` / `definitions` + `$ref`）、`.describe()` 文档说明、`Model.strict()`、`Model.union` discriminator 与 `strict` 模式守卫。
- **`StandardJSONSchemaV1` 互操作**：提供 `withJsonSchema` 包装器，在保留原 `Codec` / `Model` 全部能力的前提下挂载 `~standard.jsonSchema`。

### `@modvia/zod`

- **Zod v4 双向桥接**：提供 `zodCodec`，基于 `zod/v4/core` 桥接对称 Zod Schema 与双向 `z.codec`（兼容 `"zod"` 与 `"zod/mini"`），并将错误码统一映射为 `zod.<issue.code>`。
- **可逆性双重守卫**：在编译期（`ReversibleZodSchema`）与定义期同步拦截单向 `.transform()` / `z.preprocess()` / `z.success()`、隐式 `z.coerce.*`、吞错 `.catch()` 与异步 `z.promise()`。
