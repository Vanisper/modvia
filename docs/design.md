# Modvia 设计

## 模型边界

Modvia 在 TypeScript 应用的数据边界工作。接入代码把外部表示解码为业务值，需要写出时再按同一份声明编码为 DTO。业务模块可以直接消费普通对象、数组、日期或自定义领域实例。

核心保持零运行时依赖。HTTP、Service、缓存、UI 和平台集成由应用组合。字段规则负责同步校验与转换，远程校验和业务操作由调用方组织。

## 公共概念

| 接口                    | 职责                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `Codec<T, E>`           | 独立读写一个值。`decode(unknown)` 得到业务值 `T`，`encode(T)` 写出外部表示 `E`。     |
| `Field`                 | 值 Codec 加上字段别名与可缺省性，可通过 `from`、`or` 和 `optional` 派生新定义。      |
| `Model<Data, DTO, Out>` | 组合对象字段，同时实现 `Codec<Out, DTO>`。`Data` 是字段数据，`Out` 默认等于 `Data`。 |

内置的字符串、有限数字、布尔值、字符串枚举和日期时间规则都可以独立使用。`defineModel({ fields })` 接受任意 Codec 作为字段，包括嵌套模型、数组和 `defineCodec` 创建的自定义规则。需要在基础 Codec 上使用字段修饰时，用 `field(codec)` 包装。

`InferData`、`InferDTO`、`InferModel` 分别提取内部字段数据、编码结果和实际解码结果。模型的字段数据为只读类型。

`isoDateTime()` 以原生 `Date` 表达毫秒精度的时间点。解码直接使用输入给出的偏移量（`Z` 或 `-23:59` 至 `+23:59` 的数字偏移）换算为 UTC，再校验该时间点是否在 `Date` 的可表示范围内。编码沿用 `Date.prototype.toISOString()` 的 UTC 表示，使每个有效 `Date` 都有可以重新解码的外部表示。

## 字段组合

字段定义可以复用。每个修饰方法派生出带新约定的字段，原定义可继续用于其他模型。同一字段上的 `.from(name)`、`.or(value)` 和 `.optional()` 可以换序，各自保留其他约定。

### 字段名称

模型声明使用业务字段名。`.from(name)` 指定该字段在外部对象中的键名，父模型在解码时从该键读取，编码时写回同一键。直接对字段调用 `decode` 或 `encode` 仍然读写单个值。

同一模型内的外部键名必须唯一。业务键或外部键使用保留名 `__proto__` 时，在定义期抛出 `RangeError`。

### 字面量和值转换

`.or(value)` 接受一个显式的字符串、数字、布尔值、`null` 或 `undefined`。对业务值为 `T`、外部表示为 `E` 的字段加入字面量 `L`，两端的类型分别扩展为 `T | L` 和 `E | L`。

编解码均按 `Object.is` 优先匹配字面量，命中时原样返回，其余值交给原 Codec。例如 `number().or("auto")` 的两种业务值各有明确的外部表示。如果加入 `isoDateTime()` 的字面量恰好是一段规范的 UTC 日期字符串，日期实例和该字面量就能写出完全相同的 DTO，解码时优先得到字符串。

### 可缺省字段

父模型按字段是否存在决定是否执行值规则。默认字段缺失时报 `field.required`，`.optional()` 允许缺失，解码和编码都在结果中省略该键。字段存在时始终执行值规则。

以 `SKU = string({ trim: true, minLength: 1 })` 为例：

| 字段声明                       | `{}`     | `{ sku: null }` | `{ sku: undefined }` |
| ------------------------------ | -------- | --------------- | -------------------- |
| `SKU.or(null)`                 | 失败     | 保留 `null`     | 失败                 |
| `SKU.or(undefined)`            | 失败     | 失败            | 保留键和值           |
| `SKU.optional()`               | 保留缺省 | 失败            | 失败                 |
| `SKU.or(undefined).optional()` | 保留缺省 | 失败            | 保留键和值           |

显式 `undefined` 可以保存在内存 DTO 中，JSON 序列化会省略具有该值的对象键。

### 数组与作用域

`arrayOf(element)` 接受任意元素 Codec，返回数组字段。元素类型为 `T`、外部表示为 `E` 时，数组独立解码得到 `T[]`，编码得到 `E[]`。

```ts
const SKU = string({ trim: true, minLength: 1 });

const Shipment = defineModel({
  fields: {
    codes: arrayOf(SKU.or(null)).from("product_codes").optional(),
  },
});
```

- 元素的 `or(null)` 允许数组中出现 `null`。写成 `arrayOf(SKU).or(null)` 则允许整个数组取 `null`。
- 数组的别名与可缺省性属于父对象的字段。示例中业务键为 `codes?`，DTO 键为 `product_codes?`，两侧的元素均为 `string | null`。
- 元素的别名与可缺省性只在它作为对象字段时生效。数组按位置调用元素 Codec，`arrayOf(SKU.optional())` 中显式的 `undefined` 仍会触发字符串校验错误。

## 执行契约

### 解码外部数据

1. 对象模型接受原型为 `Object.prototype` 或 `null` 的普通对象，其他输入报 `type.object`。
2. 按声明读取外部对象的自有键，逐字段校验与转换。未知字段在此处剥离。
3. 全部字段有效时，用完整数据构造模型输出。字段校验失败时聚合为 `ModelValidationError`，其路径使用外部键名和数组下标。

### 编码业务值

模型按声明的业务字段名读取自有属性，校验并编码后用外部键名写入新 DTO。编码错误的路径使用业务字段名和数组下标。

### 输出工厂与所有权

`Base.withFactory(f)` 派生一个新模型。本模型的字段全部校验并转换后，工厂才会接收字段数据。`f` 可以返回带方法的普通对象，也可以调用真实构造器返回 class 实例。输出须满足基础字段类型，编码时仍按原字段声明读取。

`Base.withFactory(f).withFactory(g)` 使用 `g` 构造输出，`g` 接收基础字段数据。工厂派生复用字段契约，每次派生替换当前的构造函数。

对象模型和数组在解码、编码时形成新容器。自定义 Codec 决定其值对象的转换与所有权，模型数据的只读类型不代表运行时深度冻结。

### 校验错误

字段与数组聚合可定位的校验失败，`ModelValidationError.issues` 提供路径、稳定错误码和消息。自定义 Codec 通过 `context.fail(code, message)` 报告校验问题。其他异常保留原异常，包括工厂或自定义 Codec 抛出的普通异常。

## 交付与验证

模型包以 `packages/modvia/src/index.ts` 为公共入口，发布产物为 ESM 和 TypeScript 声明。

- 公共行为用例覆盖嵌套转换、字段作用域、可缺省键和值校验及错误路径。
- 类型用例验证业务值、DTO 别名与可选键、工厂输出及编解码两端的推导。
- 产物测试从包名导入，验证构建后的调用方式。工作区通过 `vp run ready` 顺序执行构建、检查与测试。
