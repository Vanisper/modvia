# modvia

`modvia` 是零运行时依赖的 TypeScript 双向编解码与领域模型层库。通过一份字段声明即可同时完成运行时校验、DTO 键名映射、嵌套结构转换与反向序列化。

当前包处于 `0.x` 开发阶段，尚未发布。

## 模块入口与分层导出

包提供三个零外部依赖的子路径入口，元操作按领域主体收纳为命名空间，高频数据形态构造器保持直接导入：

- `modvia`：完整主入口，导出领域模型主体（`Model`、`Alias`）与全部核心编解码能力。
- `modvia/codec`：纯粹的值级双向编解码底座，导出主体命名空间（`Codec`、`Field`、`ValidationError`）、0 阶标量（`string`、`number`、`int`、`boolean`、`unknown`、`literal`、`oneOf`、`isoDateTime`）与 1 阶容器（`arrayOf`、`tupleOf`、`recordOf`）。
- `modvia/formats`：按需 Tree-shaking 的标准格式、字符串数值转换与 JSON 文本原语（`uuid`、`email`、`url`、`ipv4`、`ipv6`、`isoDate`、`isoTime`、`intFromString`、`numberFromString`、`booleanFromString`、`bigintFromString`、`jsonString`、`jsonOf`），不引入时零体积开销。

## 定义模型与双向转换

```ts
import { isoDateTime, Model, oneOf, string, type InferData, type InferDTO } from "modvia";

const Department = Model.define({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
  },
});

const User = Model.define({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
    role: oneOf("admin", "manager", "member"),
    createdAt: isoDateTime().alias("created_at"),
    department: Department,
  },
});

type UserData = InferData<typeof User>;
type UserDTO = InferDTO<typeof User>;

// 面向未知外部输入（unknown）：使用 parse 解析并剥离多余字段
const user = User.parse({
  id: "u-1",
  name: "  林舟  ",
  role: "manager",
  created_at: "2026-11-09T02:00:00+02:00",
  department: { id: "d-1", name: "研发部" },
  extra: "ignored",
});

// 面向已知契约往返（DTO ↔ UserData）：使用 encode / decode（动态来源亦可用 dump）
const dto: UserDTO = User.encode(user);
// {
//   id: "u-1",
//   name: "林舟",
//   role: "manager",
//   created_at: "2026-11-09T00:00:00.000Z",
//   department: { id: "d-1", name: "研发部" }
// }
```

- 解码只接受普通对象，默认自动剥离未声明的外部属性；调用 `User.strict()` 可派生遇到未知属性即报 `object.unknown_key` 的严格模型。
- `UserData` 的属性推导为只读类型，编解码每次均返回新对象容器。
- 嵌套模型本身就是标准 `Codec`，可直接作为字段、放入数组或继续调用 `.alias()` / `.optional()` / `.nullable()` / `.describe()`。

## 2×2 执行矩阵与错误处理

所有 `Codec`、`Field` 与 `Model` 统一提供两组正交执行接口，并各自配备不抛异常的 `safe*` 判别结果变体：

- **`parse(unknown)` / `dump(unknown)`（含 `safeParse` / `safeDump`）**：面向未知或动态边界输入（如原始 JSON 响应、未定型的表单草稿或中间件载荷），运行时验明正身并执行正向解析或反向输出。
- **`decode(Encoded)` / `encode(T)`（含 `safeDecode` / `safeEncode`）**：对称强契约原语，在编译期锁死 `Encoded`（如 SDK 生成的 `DTO`）与业务类型 `T` 并提供字段补全，运行时仍完整执行校验。

```ts
import { ValidationError } from "modvia";

const result = User.safeParse(payload);
if (!result.ok) {
  for (const issue of result.issues) {
    console.log(issue.path, issue.code, issue.message);
  }
}

try {
  User.parse(payload);
} catch (error: unknown) {
  if (!ValidationError.is(error)) throw error;
  console.log(error.issues);
}
```

- 解码失败时，`issue.path` 使用外部 DTO 键名与数组下标（如 `[1, "created_at"]`）。
- 编码失败时，`issue.path` 使用模型业务键名与数组下标（如 `[1, "createdAt"]`）。
- 所有 `Codec`、`Field` 与 `Model` 均内置 `StandardSchemaV1`（`~standard`），可直接传入支持 Standard Schema 的表单与服务端框架。

## 字段映射、哨兵值与数组容器

标量、容器与嵌套模型均支持不可变链式派生：

```ts
import { arrayOf, Model, number, string } from "modvia";

const SKU = string({ trim: true, minLength: 1 });

const Product = Model.define({
  fields: {
    sku: SKU.alias("product_code").describe("Unique product SKU"),
    stock: number().or("unlimited", "discontinued"),
    tags: arrayOf(string().nullable()).alias("labels").optional(),
  },
});

const product = Product.decode({ product_code: " A-01 ", stock: "unlimited" });
// { sku: "A-01", stock: "unlimited" }

Product.encode({ ...product, tags: [null, "夏季"] });
// { product_code: "A-01", stock: "unlimited", labels: [null, "夏季"] }
```

- `.alias(name)`：指定父对象双向读写该字段时使用的外部键别名；同一模型内的外部键名不能重复。
- `string({ trim?, minLength?, maxLength?, pattern? })`：先执行可选 `trim` 清洗，再对称校验 UTF-16 长度上下界与无状态正则表达式（自动剥离有状态的 `g`/`y` 标志）。
- `number({ min?, max? })` 与 `int({ min?, max? })`：分别校验有限浮点数与安全整数（`Number.isSafeInteger`），可选限制闭区间 `[min, max]`。
- `.or(...literals)` 与 `.nullable()`：将一个或多个原始字面量作为哨兵值加入取值范围，编解码两端均按 `Object.is` 优先短路匹配。
- `.optional()`、`.required()` 与 `.default(provider)`：`.optional()` 允许父对象省略该键；`.default(...)` 在父对象解码缺键时填入业务默认值（DTO 侧键可选、模型侧键必填，对象或数组默认值须传入工厂函数 `() => value`）。显式传入 `{ sku: undefined }` 时键已存在，是否允许 `undefined` 取决于是否声明了 `.or(undefined)`。
- `arrayOf(elementCodec, { minLength?, maxLength? })` 与 `tupleOf(...codecs)`：分别编解码不定长同构数组（可选限制元素个数上下界）与定长异构元组；元素参数仅接受值级 `Codec`，编译期与定义期拒绝带 `.alias()` 或 `.optional()` 的 `Field`（可通过 `someField.codec` 提取纯值规则）。
- `recordOf(valueCodec)` 与 `recordOf(keyCodec, valueCodec)`：编解码键名动态的普通对象字典（如按语言代码或实体 ID 索引的映射表），错误路径保留对应键名。
- `literal(...values)` 与 `unknown()`：分别表达多类型精确字面量匹配以及显式原样透传的动态载荷。
- `.describe(description)`：在 `Codec`、`Field` 或 `Model` 上附加静态文档说明（与 `.alias()` / `.optional()` / `.default()` 顺序无关），零运行时校验开销并由 `@modvia/json-schema` 自动导出为 `"description"`。

## 标准格式、字符串数值与 JSON 文本编解码（`modvia/formats`）

`modvia/formats` 子路径提供遵循往返收敛律的常用格式、查询参数/环境变量字符串数值转换与 JSON 文本桥接，均附带可供 `@modvia/json-schema` 读取的格式元数据：

```ts
import { Alias, Model } from "modvia";
import {
  bigintFromString,
  booleanFromString,
  email,
  intFromString,
  ipv4,
  isoDate,
  jsonOf,
  numberFromString,
  url,
  uuid,
} from "modvia/formats";

const WebhookConfig = Model.define({
  alias: Alias.snakeCase,
  fields: {
    webhookId: uuid(), // 双端自动归一为小写 UUID
    notifyEmail: email({ trim: true, lowercase: true }),
    callbackUrl: url({ protocols: ["https"] }),
    port: intFromString({ min: 1, max: 65535 }), // string ↔ number（拒绝空串与空白）
    sampleRate: numberFromString({ min: 0, max: 1 }), // string ↔ number
    enabled: booleanFromString(), // "true"/"false" ↔ boolean
    snowflakeId: bigintFromString(), // string ↔ bigint
    allowIp: ipv4().optional(),
    expireDate: isoDate(), // 精确校验闰年与月日合法性的 YYYY-MM-DD
  },
});

// jsonOf(codec) 将任意 Codec 或 Model 包装为「JSON 字符串 ↔ 业务对象」双向 Codec
const WebhookConfigJson = jsonOf(WebhookConfig);
const config = WebhookConfigJson.parse(rawJsonText);
const serializedText: string = WebhookConfigJson.encode(config);
```

## 值精化、归一化、品牌类型与双向管道

围绕「变形（Morph）/ 归一化（Normalize）/ 精化（Refine）」三分原则，值级 `Codec` 提供完整的链式与静态组合能力：

```ts
import { Codec, int, isoDateTime, string, type Branded } from "modvia";
import { intFromString } from "modvia/formats";

// 1. 幂等归一化 + 声明式精化 + 编译期名义品牌（编码端仍保持纯净 string）
const Email = string({ trim: true })
  .normalize((s) => s.toLowerCase())
  .refine((s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s), "string.email", "Expected a valid email")
  .brand<"Email">();

type EmailAddress = Branded<string, "Email">;

// 2. 过程式多问题检查（支持通过 context.issue 附加多条错误与相对子路径）
const Port = int().check((n, ctx) => {
  if (n < 1 || n > 65535) {
    ctx.issue({ code: "number.port_range", message: "Port must be between 1 and 65535" });
  }
});

// 3. 双向管道串联（解码正向执行，编码自动逆向执行）
const PositiveCount = string({ trim: true })
  .pipe(intFromString())
  .refine((n) => n > 0, "number.positive", "Expected > 0");

// 4. 从左到右多 Codec 联合、方向反转与外部 StandardSchemaV1 同步校验器接入
const FlexibleTime = Codec.union(isoDateTime(), int());
const UtcTextFromDate = Codec.invert(isoDateTime());
const ExternalRule = Codec.fromStandard(thirdPartyStandardSchema);
```

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
const entity = UserEntityModel.parse(payload);
const entityDTO: UserDTO = UserEntityModel.encode(entity);
```

- `UserEntityModel` 与 `User` 共享相同的 `InferData` 与 `InferDTO`，原模型保持不变。
- 编码时优先读取实例自有属性；缺少自有属性时沿原型链读取最近的同名 getter（止于 `Object.prototype` 之前），非声明字段（如 `displayName`、`canManage`）不会写出到 DTO。

## 批量别名策略、模型派生与多态联合

对接统一采用 `snake_case` 或 `kebab-case` 的外部协议时，可通过 `Alias` 自动映射全部字段外部键（支持 `Alias.snakeCase`、`Alias.kebabCase` 或 `Alias.define`，单字段显式 `.alias(...)` 优先）；通过 `pick`、`omit`、`partial`、`extend`、`strict` 可从已有模型派生新契约，通过 `Model.union` 组合多态模型：

```ts
import { Alias, arrayOf, literal, Model, string } from "modvia";

// 1. 批量 snake_case 外部键映射（编译期 InferDTO 与运行期同步推导）
const Account = Model.define({
  alias: Alias.snakeCase,
  fields: {
    userId: string(),
    displayName: string({ trim: true, minLength: 1 }),
    role: literal("admin", "member").default("member"),
    legacyCode: string().alias("USR_CODE"), // 显式 .alias 优先于模型级 alias
  },
});

// 2. 裁剪、局部更新可选化、扩展与严格未知键拦截（自动保留原字段外部别名）
const AccountSummary = Account.pick("userId", "displayName");
const PatchAccountInput = Account.partial("displayName", "role").strict();
const AdminAccount = Account.extend({
  permissions: arrayOf(string()).alias("perm_list"),
});

// 3. 跨字段对称校验（解码报错路径自动翻译为外部键名，编码保持内部键名）
const PasswordPair = Model.define({
  alias: Alias.snakeCase,
  fields: { newPassword: string(), confirmPassword: string() },
}).check((data, ctx) => {
  if (data.newPassword !== data.confirmPassword) {
    ctx.issue({ code: "password.mismatch", message: "Mismatch", path: ["confirmPassword"] });
  }
});

// 4. 按标签字段 O(1) 双向分发的多态模型
const TextBlock = Model.define({
  fields: { kind: literal("text"), body: string() },
});
const ImageBlock = Model.define({
  fields: { kind: literal("image"), imageUrl: string().alias("image_url") },
});

const ContentBlock = Model.union("kind", [TextBlock, ImageBlock]);
```

## 自定义 Codec

当业务值与外部表示类型不同时，使用 `Codec.define` 声明双向转换逻辑，正反两端均须对 `unknown` 输入做类型防御并通过 `context.fail(code, message)` 报告校验错误：

```ts
import { Codec, Model } from "modvia";

const centsFromYuan = Codec.define<number, string>({
  decode(input, context) {
    if (typeof input !== "string" || !/^\d+(\.\d{1,2})?$/.test(input)) {
      return context.fail("money.format", "Expected decimal yuan string");
    }
    return Math.round(Number(input) * 100);
  },
  encode(cents, context) {
    if (typeof cents !== "number" || !Number.isSafeInteger(cents)) {
      return context.fail("money.cents", "Expected integer cents");
    }
    return (cents / 100).toFixed(2);
  },
});

const Order = Model.define({
  fields: {
    amountCents: centsFromYuan.alias("amount_yuan"),
  },
});
```

若两端类型相同且只需附加约束，优先使用 `string().refine(...)` 或 `.check(...)` 等对称校验方法。`Codec.define` 还支持通过可选的 `meta: { format, description, encodedSchema, decodedSchema }` 附加只读结构元数据（可通过 `Codec.inspect(codec)` 读取，供 `@modvia/json-schema` 导出标准 Schema）。若已有满足 `{ decode, encode }` 协议的外部对象（`CodecLike`），可直接作为模型字段或数组元素使用；需要在其上附加 `.alias()` 或 `.optional()` 时，用 `Field.of(customCodec)` 包装即可。

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

自引用结构通过 `Codec.lazy(() => Model)` 延迟求值，并为外层变量声明显式类型以帮助 TypeScript 收敛递归推导：

```ts
import { arrayOf, Codec, Model, string } from "modvia";

interface NodeData {
  readonly id: string;
  readonly children: readonly NodeData[];
}
interface NodeDTO {
  id: string;
  children: NodeDTO[];
}

const NodeModel: Model<NodeData, NodeDTO> = Model.define({
  fields: {
    id: string(),
    children: arrayOf(Codec.lazy(() => NodeModel)),
  },
});
```

## 错误码速查

`issue.code` 为稳定标识，可用于程序化分支处理：

| 错误码                  | 触发条件                                                            |
| ----------------------- | ------------------------------------------------------------------- |
| `type.object`           | 解码输入不是普通对象，或编码输入为 `null`、数组或非对象             |
| `object.unknown_key`    | `Model.strict()` 解码时遇到未声明的外部自有属性                     |
| `type.array`            | `arrayOf` 或 `tupleOf` 收到非数组输入                               |
| `array.min_length`      | `arrayOf(codec, { minLength })` 数组元素个数不足                    |
| `array.max_length`      | `arrayOf(codec, { maxLength })` 数组元素个数超出上限                |
| `tuple.length`          | `tupleOf` 收到的数组长度与声明的元组长度不一致                      |
| `type.string`           | `string()` 或字符串格式规则收到非字符串输入                         |
| `type.number`           | `number()` 或 `numberFromString()` 编码收到非有限数字               |
| `type.integer`          | `int()` 或 `intFromString()` 编码收到非安全整数                     |
| `type.bigint`           | `bigintFromString()` 编码收到非 `bigint` 值                         |
| `number.min`            | `number`、`int`、`numberFromString` 或 `intFromString` 小于最小下界 |
| `number.max`            | `number`、`int`、`numberFromString` 或 `intFromString` 大于最大上界 |
| `type.boolean`          | `boolean()` 或 `booleanFromString()` 编码收到非布尔值               |
| `type.datetime`         | `isoDateTime()` 解码输入非字符串，或编码输入不是有效 `Date`         |
| `string.min_length`     | `string({ minLength })` 长度不足（按 UTF-16 码元计）                |
| `string.max_length`     | `string({ maxLength })` 长度超出上限（按 UTF-16 码元计）            |
| `string.pattern`        | `string({ pattern })` 未匹配指定正则表达式                          |
| `string.one_of`         | `oneOf()` 收到枚举集合之外的值                                      |
| `value.literal`         | `literal()` 收到声明字面量集合之外的值                              |
| `datetime.invalid`      | 日期时间字符串的格式、日历日期、时分秒或时区偏移非法                |
| `datetime.out_of_range` | 日期时间换算为 UTC 后超出原生 `Date` 可表示范围                     |
| `format.uuid`           | `uuid()` 收到非法 UUID 字符串                                       |
| `format.email`          | `email()` 收到非法电子邮箱地址                                      |
| `format.url`            | `url()` 收到非法 URL 字符串                                         |
| `format.url_protocol`   | `url({ protocols })` 协议不在允许白名单内                           |
| `format.ipv4`           | `ipv4()` 收到非法 IPv4 地址                                         |
| `format.ipv6`           | `ipv6()` 收到非法 IPv6 地址                                         |
| `format.iso_date`       | `isoDate()` 收到非法 `YYYY-MM-DD` 公历日期                          |
| `format.iso_time`       | `isoTime()` 收到非法 `HH:mm:ss` 时钟时间                            |
| `format.int_string`     | `intFromString()` 收到非十进制安全整数文本                          |
| `format.number_string`  | `numberFromString()` 收到非有限数值文本                             |
| `format.boolean_string` | `booleanFromString()` 收到不在真/假词集合内的文本                   |
| `format.bigint_string`  | `bigintFromString()` 收到非十进制整数文本                           |
| `format.json`           | `jsonString()` 收到非法 JSON 文本或不可 JSON 序列化的值             |
| `record.duplicate_key`  | `recordOf` 的键经 `keyCodec` 转换后发生同名碰撞                     |
| `union.no_match`        | `Codec.union` 的所有候选分支均未匹配当前输入                        |
| `union.invalid_tag`     | `Model.union` 的判别字段值不在已注册的分支标签集合内                |
| `standard.invalid`      | `Codec.fromStandard` 包装的外部校验器未提供错误码时的默认标识       |
| `field.required`        | 解码对象缺少必填外部键，或编码对象缺少可读取的必填声明字段          |

## 开发与验证

在工作区根目录执行完整构建、检查与测试：

```sh
vp run ready
```
