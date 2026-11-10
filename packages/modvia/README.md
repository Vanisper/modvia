# modvia

`modvia` 是独立的 TypeScript 模型层库，用一份声明完成运行时校验、DTO 映射、嵌套构造和双向序列化。普通对象可以直接使用全部核心能力；需要领域行为时，再通过工厂输出 class 实例。

当前包处于开发阶段，尚未发布。

## 定义与解码

```ts
import { defineModel, type InferData, type InferDTO, isoDateTime, oneOf, string } from "modvia";

const Department = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
  },
});

const User = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
    role: oneOf("admin", "manager", "member"),
    createdAt: isoDateTime().from("created_at"),
    department: Department,
  },
});

type UserData = InferData<typeof User>;
type UserDTO = InferDTO<typeof User>;

const user = User.decode({
  id: "u-1",
  name: "  林舟  ",
  role: "manager",
  created_at: "2026-11-09T02:00:00+02:00",
  department: { id: "d-1", name: "研发部" },
  extra: "ignored",
});
```

`user` 是带完整类型的普通对象：名称已去除首尾空白，`createdAt` 是有效 `Date`，`department` 已递归构造，未声明的 `extra` 被剥离。`UserData` 的字段为只读类型，但运行时不会自动深度冻结对象。

## 编码回 DTO

```ts
const dto: UserDTO = User.encode(user);
```

结果为新的普通对象：

```ts
{
  id: "u-1",
  name: "林舟",
  role: "manager",
  created_at: "2026-11-09T00:00:00.000Z",
  department: { id: "d-1", name: "研发部" },
}
```

编码只读取声明字段，仍会执行字段 Codec。日期输出统一为 UTC ISO 字符串；其他规范化转换以对应字段 Codec 为准。

## 列表

```ts
import { arrayOf } from "modvia";

const Users = arrayOf(User);
const users = Users.decode(response);
const dtoList = Users.encode(users);
```

列表输入必须是数组。元素错误保留数组下标，例如 `[2, "department", "name"]`。

## class 输出

class 工厂接收已经完成校验和转换的数据，不接触原始 DTO：

```ts
class UserEntity {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly role: "admin" | "manager" | "member";
  declare readonly createdAt: Date;
  declare readonly department: UserData["department"];

  constructor(data: UserData) {
    Object.assign(this, data);
  }

  get displayName(): string {
    return `${this.name} · ${this.department.name}`;
  }

  canManage(): boolean {
    return this.role === "admin" || this.role === "manager";
  }
}

const UserEntityModel = User.withFactory((data) => new UserEntity(data));
const entity = UserEntityModel.decode(response);

entity.displayName;
entity.canManage();

const entityDTO: UserDTO = UserEntityModel.encode(entity);
```

`User` 与 `UserEntityModel` 共享 Data 和 DTO，原模型不会被修改。核心执行真实构造器，不绕过构造器或动态安装业务方法。依赖私有状态的 class 应提供自定义 Codec；默认编码只读取公开声明字段。

## 自定义 Codec

```ts
import { defineCodec, field } from "modvia";

const slug = defineCodec<string, string>({
  decode(input, context) {
    if (typeof input !== "string" || !/^[a-z0-9-]+$/.test(input)) {
      return context.fail("string.slug", "Expected a lowercase slug");
    }
    return input;
  },
  encode(value, context) {
    if (!/^[a-z0-9-]+$/.test(value)) {
      return context.fail("string.slug", "Expected a lowercase slug");
    }
    return value;
  },
});

const Article = defineModel({
  fields: {
    slug: field(slug).from("article_slug"),
  },
});
```

`context.fail()` 产生统一的模型校验错误。自定义 Codec 抛出的其他异常原样传播，不会被误报为用户输入错误。

## 错误处理

```ts
import { isModelValidationError } from "modvia";

try {
  User.decode(payload);
} catch (error: unknown) {
  if (!isModelValidationError(error)) throw error;

  for (const issue of error.issues) {
    console.log(issue.path, issue.code, issue.message);
  }
}
```

字段失败会聚合成一个 `ModelValidationError`。路径指向当前输入：解码使用 DTO 字段名，编码使用模型字段名。

## 当前边界

- 所有字段均为必填；可选、可空和默认值尚未提供。
- 字段外部名（别名或字段名）在定义时必须唯一，重复会在 `defineModel` 抛出 `RangeError`。
- 对象与数组会构造新容器，但核心不执行通用深拷贝。
- 未知 DTO 字段在解码时剥离；编码不会输出方法或未声明字段。
- 不提供跨字段校验、异步校验、class 继承、装饰器或局部 Patch 推导。
- 不依赖 HTTP、Service、UI、缓存或具体运行平台。

## 开发

```sh
vp test
vp check
vp pack
```
