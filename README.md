# Modvia

Modvia 是面向 TypeScript 应用的模型层基础库。它以业务模型为中心，统一运行时校验、DTO 映射与双向序列化，让 Service 和页面消费可信模型，而不是重复编写字段检查与对象拷贝。

## 核心思路

- **普通对象优先**：不继承基类即可获得完整的定义、校验、嵌套转换与编码能力。
- **class 可选**：通过真实工厂创建领域实例，保留构造器、原型方法和领域行为。
- **双向契约明确**：同一份模型定义连接外部 DTO 与内部模型，不依赖类型断言或隐式字段猜测。
- **模型层独立**：不依赖 HTTP、Service 框架、UI、缓存或具体平台。

## 快速示例

```ts
import { defineModel, string, type InferData } from "modvia";

const User = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
  },
});

type UserData = InferData<typeof User>;

const user = User.decode({ id: "u-1", name: "  林舟  ", extra: "ignored" });
// { id: "u-1", name: "林舟" }

const dto = User.encode(user);
```

字段别名、嵌套模型、数组、自定义 Codec 和 class 工厂见[模型包使用说明](packages/modvia/README.md)。定位、首轮范围与模块职责见[设计文档](docs/design.md)。

## 开发

```sh
vp install --frozen-lockfile
vp run ready
```

`ready` 依次执行格式与静态检查、工作区测试和构建。模型包位于 `packages/modvia`；`apps/website` 与 `packages/utils` 保留为 Vite+ 工具链示例。
