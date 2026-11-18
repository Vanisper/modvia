# modvia

`modvia` 是独立的 TypeScript 模型层库，用一份声明完成运行时校验、DTO 映射、嵌套构造和双向序列化。模型默认返回普通对象，也可以通过工厂构造带方法的对象或 class 实例。

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

`user` 是带完整类型的普通对象：

- `name` 去除了首尾空白，`createdAt` 转为有效 `Date`；
- `department` 递归构造为嵌套模型数据；
- 未声明的 `extra` 被剥离；
- `UserData` 的字段为只读类型，但运行时不会自动深度冻结对象。

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

## 字段组合

字段可以独立读写，也可以作为多个模型的字段复用。`.from(name)`、`.or(value)` 和 `.optional()` 都返回派生字段，保留同一字段上的其他约定。

```ts
import { arrayOf, defineModel, number, string } from "modvia";

const SKU = string({ trim: true, minLength: 1 });
const Product = defineModel({
  fields: {
    sku: SKU.from("product_code"),
    stock: number().or("unlimited"),
    tags: arrayOf(string().or(null)).from("labels").optional(),
  },
});

const product = Product.decode({ product_code: " A-01 ", stock: "unlimited" });
// { sku: "A-01", stock: "unlimited" }

Product.encode({ ...product, tags: [null, "夏季"] });
// { product_code: "A-01", stock: "unlimited", labels: [null, "夏季"] }
```

- `from` 在模型读写外部对象时指定键名。`SKU` 本身仍可用作同名字段，或直接调用 `SKU.decode(" A-01 ")`。
- `or` 接受一个显式字符串、数字、布尔值、`null` 或 `undefined`，两端类型都增加该字面量。编解码时按 `Object.is` 优先匹配，命中后直接保留它。若加入的字符串恰好也是 `isoDateTime()` 的规范输出，解码该字符串时会得到字符串。
- `optional` 允许父对象省略键，解码与编码都保留缺省。示例中的业务类型有 `readonly tags?: (string | null)[]`，DTO 则有 `labels?: (string | null)[]`。

字段值为 `undefined` 时键已经存在。对 `SKU.optional()`，`{}` 可以通过，`{ sku: undefined }` 会触发 `type.string`。对 `SKU.or(undefined)`，后者会保留键和值，缺键则触发 `field.required`。两种输入都合法时写 `SKU.or(undefined).optional()`。TypeScript 的 `exactOptionalPropertyTypes` 设置影响显式 `undefined` 的静态检查，运行时始终按字段规则校验。

## 列表

```ts
import { arrayOf } from "modvia";

const Users = arrayOf(User);
const users = Users.decode(response);
const dtoList = Users.encode(users);
```

- 列表输入必须是数组。元素错误保留下标，例如 `[2, "department", "name"]`。
- `arrayOf(string().or(null))` 允许单个元素为 `null`，`arrayOf(string()).or(null)` 允许整个数组为 `null`。
- `arrayOf(...).from(...).optional()` 声明数组字段的外部名和可缺省性。

## 工厂输出

`withFactory` 的回调接收已经完成校验和转换的字段数据。它可以返回带方法或计算属性的普通对象，也可以通过已有构造器创建 class 实例。

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
const entity = UserEntityModel.decode(response);

entity.displayName;
entity.canManage();

const entityDTO: UserDTO = UserEntityModel.encode(entity);
```

- `User` 与 `UserEntityModel` 共享 Data 和 DTO，原模型不会被修改。
- 编码时，声明字段 `name` 通过实例的公开 getter 读取，`displayName` 与 `canManage` 留在业务对象上。

如果业务约定缺少页大小时取 20，可以在工厂中补上这个值。此后编码会写出补全后的字段。

```ts
import { defineModel, number } from "modvia";

const Page = defineModel({ fields: { size: number().optional() } }).withFactory((data) => ({
  size: data.size ?? 20,
}));

const page = Page.decode({}); // { size: 20 }
Page.encode(page); // { size: 20 }
```

## 自定义 Codec

```ts
import { defineCodec, defineModel, field } from "modvia";

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

- 字段默认必填。缺键用 `.optional()` 表达，允许的特殊值用 `.or(value)` 表达。
- 字段外部名（别名或字段名）在定义时必须唯一，重复时 `defineModel` 抛出 `RangeError`。
- `__proto__` 可以作为字段名或别名。对象字面量使用计算属性名 `["__proto__"]` 声明自有键，`JSON.parse` 也会保留同名自有键。默认解码对象和编码后的 DTO 都保留普通对象原型。
- 解码输入只接受普通对象：`null`、数组、`Date`、`Map` 与 class 实例均报 `type.object`；原型为 `null` 的对象可以接受。
- 对象与数组会构造新容器，但核心不执行通用深拷贝。
- 未知 DTO 字段在解码时剥离；编码不会输出方法或未声明字段。
- 编码优先读取声明字段的自有属性，再沿原型链查找最近的同名成员，止于 `Object.prototype` 之前。原型 getter 以实例为 `this` 读取一次。同名方法、原型数据属性或只有 setter 的成员会遮蔽上层 getter，按缺字段处理。getter 返回 `undefined` 时仍要校验该值。
- 模型不能直接自引用；递归结构需要显式注解类型后再组合，见下方说明。
- class 的字段契约由模型显式声明。跨字段校验、异步校验和局部更新的业务规则由应用处理。
- 不依赖 HTTP、Service、UI、缓存或具体运行平台。

## 日期时间

`isoDateTime()` 适合创建时间、事件发生时间等确定的时间点。解码得到毫秒精度的 `Date`，编码统一输出 UTC 字符串。原始偏移和毫秒之后的小数位会丢失。

```ts
import { isoDateTime } from "modvia";

const timestamp = isoDateTime();
const instant = timestamp.decode("2026-11-19T00:15:00.123456+08:00");
timestamp.encode(instant); // "2026-11-18T16:15:00.123Z"
```

- 输入由日期、`T`、完整的时分秒和时区偏移组成。年份接受四位数字或带正负号的六位数字，`-000000` 为非法年份。
- 偏移写作 `Z` 或 `±HH:mm`。数字偏移的小时范围是 `00`–`23`，分钟范围是 `00`–`59`，因此 `+23:59` 和 `-23:59` 都有效。
- 小数秒可省略，也可提供一位或多位数字。解码截断超出毫秒的部分，编码固定输出三位小数秒。
- 换算为 UTC 后，时间值必须在原生 `Date` 的范围内，即距 Unix 纪元不超过 `8_640_000_000_000_000` 毫秒，含两个端点。
- 编码按 UTC 年份选择表示。`0000`–`9999` 使用四位数字，范围以外使用带正负号的六位数字。例如 `9999-12-31T23:30:00-01:00` 会写成 `+010000-01-01T00:30:00.000Z`。
- 纯日期、无偏移的本地日期时间和数字时间戳不在该字段的输入范围内。这些协议可以通过自定义 Codec 指定业务表示和单位。

## 递归模型

模型不能在自己的字段里直接引用自己，需要在第一次引用前给外层变量一个显式类型：

```ts
import { defineModel, defineCodec, arrayOf, string, type Codec, type Model } from "modvia";

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

## 错误码

`issue.code` 是稳定标识，可以用于分支判断：

| code                    | 来源                                                  |
| ----------------------- | ----------------------------------------------------- |
| `type.object`           | 解码输入非普通对象，或编码输入为 `null`、数组或非对象 |
| `type.array`            | `arrayOf` 收到非数组                                  |
| `type.string`           | `string()` 收到非字符串                               |
| `type.number`           | `number()` 收到非有限数字                             |
| `type.boolean`          | `boolean()` 收到非布尔值                              |
| `type.datetime`         | 解码输入不是字符串，或编码输入不是有效的 `Date`       |
| `string.min_length`     | `string({ minLength })` 长度不足                      |
| `string.one_of`         | `oneOf()` 收到枚举外的值                              |
| `datetime.invalid`      | 日期时间字符串的格式、日期、时间或偏移非法            |
| `datetime.out_of_range` | 解码输入换算为 UTC 后超出原生 `Date` 的时间范围       |
| `field.required`        | 缺少必填的外部键，或模型缺少可读取的必填字段          |

`string()` 的长度按 UTF-16 码元计算，因此一个基本多文种平面之外的字符（如 emoji）计为 2。

## 开发

在工作区根目录运行完整验证。

```sh
vp run ready
```

`tests/artifact.test.ts` 通过包名消费 `dist` 产物。单独在包目录运行 `vp test` 时，先运行 `vp pack`。
