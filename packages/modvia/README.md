# modvia

`modvia` 是零运行时依赖的 TypeScript 双向编解码与领域模型层库。通过一份字段声明即可同时完成运行时校验、DTO 键名映射、嵌套结构转换与反向序列化。

当前包处于 `0.x` 开发阶段，尚未发布。

## 模块入口

包提供两个子路径入口，共享同一套底层原语：

- `modvia`：完整入口，包含领域模型（`defineModel`）与全部编解码能力。
- `modvia/codec`：纯粹的值级双向编解码底座，不包含领域模型层，适合仅需值转换与容器校验的场景。

## 定义模型与双向转换

```ts
import { defineModel, isoDateTime, oneOf, string, type InferData, type InferDTO } from "modvia";

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

const dto: UserDTO = User.encode(user);
// {
//   id: "u-1",
//   name: "林舟",
//   role: "manager",
//   created_at: "2026-11-09T00:00:00.000Z",
//   department: { id: "d-1", name: "研发部" }
// }
```

- 解码只接受普通对象，自动剥离未声明的外部属性。
- `UserData` 的属性推导为只读类型，编解码每次均返回新对象容器。
- 嵌套模型本身就是标准 `Codec`，可直接作为字段、放入数组或继续调用 `.from()` / `.optional()` / `.nullable()`。

## 安全解析与错误处理

除抛出 `ValidationError` 的 `decode` / `encode` 外，所有编解码器与模型均提供不抛异常的 `safeDecode` / `safeEncode`：

```ts
import { isValidationError } from "modvia";

const result = User.safeDecode(payload);
if (!result.ok) {
  for (const issue of result.issues) {
    console.log(issue.path, issue.code, issue.message);
  }
}

try {
  User.decode(payload);
} catch (error: unknown) {
  if (!isValidationError(error)) throw error;
  console.log(error.issues);
}
```

- 解码失败时，`issue.path` 使用外部 DTO 键名与数组下标（如 `[1, "created_at"]`）。
- 编码失败时，`issue.path` 使用模型业务键名与数组下标（如 `[1, "createdAt"]`）。
- 所有 `Codec`、`Field` 与 `Model` 均内置 `StandardSchemaV1`（`~standard`），可直接传入支持 Standard Schema 的表单与服务端框架。

## 字段映射、哨兵值与数组容器

标量、容器与嵌套模型均支持不可变链式派生：

```ts
import { arrayOf, defineModel, number, string } from "modvia";

const SKU = string({ trim: true, minLength: 1 });

const Product = defineModel({
  fields: {
    sku: SKU.from("product_code"),
    stock: number().or("unlimited", "discontinued"),
    tags: arrayOf(string().nullable()).from("labels").optional(),
  },
});

const product = Product.decode({ product_code: " A-01 ", stock: "unlimited" });
// { sku: "A-01", stock: "unlimited" }

Product.encode({ ...product, tags: [null, "夏季"] });
// { product_code: "A-01", stock: "unlimited", labels: [null, "夏季"] }
```

- `.from(name)`：指定父对象读写该字段时使用的外部键名；同一模型内的外部键名不能重复。
- `.or(...literals)` 与 `.nullable()`：将一个或多个原始字面量作为哨兵值加入取值范围，编解码两端均按 `Object.is` 优先短路匹配。
- `.optional()` 与 `.required()`：控制父对象是否允许省略该键；显式传入 `{ sku: undefined }` 时键已存在，是否允许 `undefined` 取决于是否声明了 `.or(undefined)`。
- `arrayOf(elementCodec)`：按位置编解码数组元素；元素参数仅接受值级 `Codec`，若对元素误传带 `.from()` 或 `.optional()` 的 `Field`，编译期与定义期均会直接拦截（可通过 `someField.codec` 提取纯值规则）。

## 领域工厂与 Class 实例

`withFactory` 在整棵对象树完成校验与转换后调用工厂函数，可返回带方法的对象或真实 `class` 实例：

```ts
class UserEntity {
  declare readonly id: string;
  readonly #name: string;
  declare readonly role: "admin" | "manager" | "member";
  declare readonly createdAt: Date;
  declare readonly department: UserData["department"];

  constructor({ name, ...fields }: UserData) {
    this.#name = name;
    Object.assign(this, fields);
  }

  get name(): string {
    return this.#name;
  }

  get displayName(): string {
    return `${this.name} · ${this.department.name}`;
  }

  canManage(): boolean {
    return this.role === "admin" || this.role === "manager";
  }
}

const UserEntityModel = User.withFactory((data) => new UserEntity(data));
const entity = UserEntityModel.decode(payload);
const entityDTO: UserDTO = UserEntityModel.encode(entity);
```

- `UserEntityModel` 与 `User` 共享相同的 `InferData` 与 `InferDTO`，原模型保持不变。
- 编码时优先读取实例自有属性；缺少自有属性时沿原型链读取最近的同名 getter（止于 `Object.prototype` 之前），非声明字段（如 `displayName`、`canManage`）不会写出到 DTO。

## 自定义 Codec

使用 `defineCodec` 创建标准双向编解码器，并通过 `context.fail(code, message)` 报告校验错误：

```ts
import { defineCodec, defineModel } from "modvia";

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
    slug: slug.from("article_slug"),
  },
});
```

若已有满足 `{ decode, encode }` 协议的外部对象（`CodecLike`），可直接作为模型字段或数组元素使用；需要在其上附加 `.from()` 或 `.optional()` 时，用 `field(customCodec)` 包装即可。

## 日期时间

`isoDateTime()` 将带时区偏移的 ISO 日期时间字符串与毫秒精度 `Date` 互转：

```ts
import { isoDateTime } from "modvia/codec";

const timestamp = isoDateTime();
const instant = timestamp.decode("2026-11-19T00:15:00.123456+08:00");
timestamp.encode(instant); // "2026-11-18T16:15:00.123Z"
```

- 输入必须包含日期、`T`、完整时分秒以及偏移量（`Z` 或 `-23:59` 至 `+23:59`）；年份支持四位数字或带符号六位数字（`-000000` 非法）。
- 解码截断毫秒之后的小数位，校验公历日期合法性，并检查换算为 UTC 后的时间戳是否落在原生 `Date` 的 `±8_640_000_000_000_000` 毫秒范围内。
- 编码统一输出三位小数秒的 UTC 字符串（`0000`–`9999` 年为四位年份，范围外为带符号六位年份）。

## 递归模型

自引用结构需先为外层变量声明显式类型以帮助 TypeScript 结束递归推导：

```ts
import { arrayOf, defineCodec, defineModel, string, type Codec, type Model } from "modvia";

interface NodeData {
  readonly id: string;
  readonly children: readonly NodeData[];
}
interface NodeDTO {
  id: string;
  children: NodeDTO[];
}

const nodeCodec: Codec<NodeData, NodeDTO> = defineCodec({
  decode: (input) => nodeModel.decode(input),
  encode: (value) => nodeModel.encode(value),
});

const nodeModel: Model<NodeData, NodeDTO> = defineModel({
  fields: { id: string(), children: arrayOf(nodeCodec) },
});
```

## 错误码速查

`issue.code` 为稳定标识，可用于程序化分支处理：

| 错误码                  | 触发条件                                                    |
| ----------------------- | ----------------------------------------------------------- |
| `type.object`           | 解码输入不是普通对象，或编码输入为 `null`、数组或非对象     |
| `type.array`            | `arrayOf` 收到非数组输入                                    |
| `type.string`           | `string()` 收到非字符串输入                                 |
| `type.number`           | `number()` 收到非有限数字（含 `NaN`、`±Infinity` 或非数字） |
| `type.boolean`          | `boolean()` 收到非布尔值                                    |
| `type.datetime`         | `isoDateTime()` 解码输入非字符串，或编码输入不是有效 `Date` |
| `string.min_length`     | `string({ minLength })` 长度不足（按 UTF-16 码元计）        |
| `string.one_of`         | `oneOf()` 收到枚举集合之外的值                              |
| `datetime.invalid`      | 日期时间字符串的格式、日历日期、时分秒或时区偏移非法        |
| `datetime.out_of_range` | 日期时间换算为 UTC 后超出原生 `Date` 可表示范围             |
| `field.required`        | 解码对象缺少必填外部键，或编码对象缺少可读取的必填声明字段  |

## 开发与验证

在工作区根目录执行完整构建、检查与测试：

```sh
vp run ready
```
