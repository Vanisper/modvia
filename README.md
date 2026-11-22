# Modvia

Modvia 是面向 TypeScript 应用的双向编解码与领域模型层基础库，核心保持零运行时依赖。

它以双向契约为中心，统一外部数据校验、DTO 键名映射、嵌套对象构造与反向序列化，使业务模块直接消费可信模型，无需重复编写入参检查与字段搬运代码。

## 核心特性

- **分层双入口**：`modvia/codec` 提供独立的值级双向编解码底座，`modvia` 在其上构建对象字段映射与领域模型。
- **普通对象优先，class 可选**：默认产出零额外开销的普通对象；通过 `withFactory` 可按需构造真实 `class` 实例并保留原型行为。
- **作用域严格正交**：值域扩展（`.or` / `.nullable`）与对象键规则（`.from` / `.optional`）职责分离，编译期拦截容器作用域误用。
- **双模式执行与生态互操作**：同时提供抛错调用与 `safeDecode` / `safeEncode` 判别结果，原生实现 `StandardSchemaV1`（`~standard` / `fromStandard`），并通过独立包 `@modvia/zod` 双向桥接 Zod v4。

## 快速示例

```ts
import { defineModel, isoDateTime, string, type InferData, type InferDTO } from "modvia";

const User = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
    createdAt: isoDateTime().from("created_at"),
  },
});

type UserData = InferData<typeof User>;
type UserDTO = InferDTO<typeof User>;

const user = User.decode({
  id: "u-1",
  name: "  林舟  ",
  created_at: "2026-11-09T02:00:00+02:00",
  extra: "ignored",
});
// { id: "u-1", name: "林舟", createdAt: Date("2026-11-09T00:00:00.000Z") }

const dto = User.encode(user);
// { id: "u-1", name: "林舟", created_at: "2026-11-09T00:00:00.000Z" }
```

## 文档导航

- [核心包使用手册](packages/modvia/README.md)：`modvia` 与 `modvia/codec` API 用法、场景示例与稳定错误码表。
- [Zod 桥接手册](packages/zod/README.md)：`@modvia/zod` 双向桥接用法与可逆性守卫。
- [架构与包规划](docs/architecture.md)：分层模型、模块边界与演进路线。
- [语义与设计规范](docs/design.md)：编解码契约、组合代数与对象读写不变量。

## 工作区开发

```sh
vp install --frozen-lockfile
vp run ready
```

`vp run ready` 按依赖顺序执行：

1. 工作区构建（生成 `dist` 与类型声明）；
2. 格式、静态检查与分层依赖守卫；
3. 单元与产物集成测试（`tests/artifact.test.ts` 直接通过 `modvia`、`modvia/codec` 与 `@modvia/zod` 包出口验证构建产物）。

核心实现位于 `packages/modvia`，Zod 生态桥接位于 `packages/zod`；`apps/website` 与 `packages/utils` 仅保留为 Vite+ 工具链示例。
