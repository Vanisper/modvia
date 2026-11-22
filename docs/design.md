# Modvia 语义与设计规范

Modvia 工作在 TypeScript 应用的数据边界：接入层将不可信的外部输入解码为业务值，写出层按同一份声明将业务值编码回 DTO。本文定义核心抽象的语义契约与执行不变量。

## 双向收敛与操作三分原则

所有编解码操作严格划分为三类互不越界的原语，共同维持「合法业务值往返收敛（`decode(encode(t)) ≡ t`）」的核心不变量：

- **跨表示变形（Morph，`E ↔ T`）**：改变值的外部与内部表示（如 `string ↔ Date`、`DTO ↔ 领域实体`），必须显式声明正向 `decode` 与反向 `encode`（如 `defineCodec`、`pipe`），禁止引入破坏编码可逆性的单向转换或隐式宽泛强转。
- **同类型规范化（Normalize，`T → T`）**：不改变类型，仅将合法值投影至幂等规范形态（如 `.normalize(s => s.toLowerCase())`、空白裁剪、UTC 归一化）；解码与编码两端共同保证输出处于同一规范形态。
- **域内精化与品牌（Refine / Check / Brand，`T ⊇ SubT`）**：不改写值，仅收窄合法值子集（`.refine`、`.check`）或附加零运行时开销的编译期名义标签（`.brand`）；精化约束在入口解码与出口编码两端对称执行，防止非法状态流入领域层或流出至外部协议。
- **双端类型诚实性准则**：`Codec<T, Encoded>` 的外部泛型 `Encoded` 必须精确对应合法外部表示的最小静态类型；仅当外部槽位本身允许任意动态形态（如 `unknown()` 及其品牌/精化派生）时 `Encoded` 才为 `unknown`，禁止将具有确定外部形态的规则宽泛声明为 `unknown` 而导致反向输出发生静态类型失忆。

## 核心抽象与作用域

系统由四个渐进接口构成：

| 接口                            | 所属作用域 | 职责                                                                                                 |
| ------------------------------- | ---------- | ---------------------------------------------------------------------------------------------------- |
| `CodecLike<T, E>`               | 值级协议   | 最小双向实现协议，正反两端均接收 `unknown` 做运行时防御并分别产出 `T` 与 `E`，供自定义对象直接接入。 |
| `Codec<T, E>`                   | 值级实例   | 标准双向编解码器，提供强契约 `decode`/`encode`、宽边界 `parse`/`dump`、`~standard` 及字段跃迁方法。  |
| `Field<T, E, Source, Presence>` | 对象属性级 | 将 `Codec` 绑定到具名属性槽位，承载外部键别名（`source`）与键缺省规则（`presence`）。                |
| `Model<Data, DTO, Out>`         | 领域模型级 | 组合字段表形成对象契约，本身亦是 `Codec<Out, DTO>`，支持通过 `withFactory` 派生领域实例输出。        |

内置标量（`string`、`number`、`int`、`boolean`、`oneOf`、`literal`、`unknown`、`isoDateTime`）、值容器（`arrayOf`、`tupleOf`、`recordOf`）、组合子（`pipe`、`invert`、`lazy`、`unionOf`、`fromStandard`）与模型（`defineModel`）均返回标准 `Codec`：

- 任意 `Codec`（包括嵌套 `Model`）都可直接调用 `.alias(name)`、`.optional()` 或 `.default(...)` 跃迁为 `Field`，无需额外包装函数。
- 值级容器与组合子（`arrayOf`、`tupleOf`、`recordOf`、`pipe`、`invert`、`lazy`、`unionOf`）仅接受值级 `Codec` 或裸 `CodecLike`，在编译期与定义期同时拒绝带键绑定元数据的 `Field`。
- 若需复用已有 `Field` 的底层值规则作为容器元素，可通过 `field.codec` 显式取回纯值级 `Codec`。

## 执行模型与 2×2 边界协议

消费端执行接口按「方向（正向 / 反向）× 编译期入参状态（已知契约 / 未知 `unknown`）」构成正交的 2×2 矩阵，并共享同一套零异常栈 `IssueCollector` 调度内核：

| 方向            | 强契约原语（编译期锁死两端静态类型）           | 动态边界门面（编译期放宽入参为 `unknown`）        |
| --------------- | ---------------------------------------------- | ------------------------------------------------- |
| 正向（外 → 内） | `decode(input: E): T` / `safeDecode(input: E)` | `parse(input: unknown): T` / `safeParse(unknown)` |
| 反向（内 → 外） | `encode(value: T): E` / `safeEncode(value: T)` | `dump(input: unknown): E` / `safeDump(unknown)`   |

- **`decode` / `encode`**：在编译期校验上下游已知类型契约并提供属性补全，运行时仍执行完整的零信任校验。
- **`parse` / `dump`**：面向编译期未知或动态来源（如原始网络载荷、未定型表单草稿、通用缓存/消息中间件），运行时验明正身并转换。
- **抛错与安全结果对偶**：`safeDecode`、`safeEncode`、`safeParse` 与 `safeDump` 直接返回冻结的判别联合 `SafeResult<T>`，全程不构造 `Error` 实例；普通方法仅在顶层出口一次性构造并抛出 `ValidationError`。
- 自定义底层规则（`defineCodec` / `CodecLike`）在正反两端均须校验 `unknown` 输入，可通过 `context.fail(code, message)` 立即中断当前规则，或通过 `context.issue({ code, message, path? })` 非中断收集多条错误及相对子路径；其他普通运行时异常原样向外传播。
- 所有 `Codec`、`Field` 与 `Model` 均原生挂载 `StandardSchemaV1` 的 `"~standard"` 属性，同时可通过零依赖的 `fromStandard(schema)` 将外部同步 `StandardSchemaV1` 校验器桥接为对称 `Codec`。

## 组合代数与链式规则

每次调用修饰方法均返回冻结的新定义，原定义保持不可变并可跨模型复用。系统不提供通用的黑盒交集算子（`.and()`），而是将「单值叠加约束」与「对象合并字段」分别交由值级管道（`.check` / `pipe`）与模型扩展承接。各方法遵循明确的代数规则：

- **管道包裹顺序（`.check` / `.pipe`）**：`.check(rule)` 在基础 `Codec` 通过后对业务值执行对称约束，解码与编码均按书写顺序由内向外执行；`pipe(first, second)` 在解码时按 `first → second` 正向传递，在编码时按 `second → first` 逆向传递。
- **字面量哨兵优先（`.or` / `.nullable`）**：接受一个或多个原始字面量（`string | number | boolean | null | undefined`），编解码两端均先按 `Object.is` 短路匹配字面量，未命中时再交由当前内部 `Codec` 处理。连续相邻调用 `.or(a).or(b)` 与单次调用 `.or(a, b)` 等价，内部自动扁平化合并；与 `.check` 交错时严格遵循外层包裹内层的洋葱顺序。
- **多分支从左到右联合（`unionOf`）**：按参数顺序依次尝试分支，首个无错误返回的分支胜出并回滚前序分支的试探记录；全部分支均不匹配时报 `union.no_match`。
- **方向反转与惰性引用（`invert` / `lazy`）**：`invert` 对调 `decode` 与 `encode` 方向；`lazy` 将目标 `Codec` 的求值推迟到首次运行并缓存解析结果，支持自引用递归结构。
- **动态字典容器（`recordOf`）**：接受纯对象输入，逐个自有可枚举键执行键与值的双向转换；若键转换后产生同名碰撞则报 `record.duplicate_key`。
- **外部键别名重绑覆盖（`.alias`）**：多次调用 `.alias("a").alias("b")` 以最后一次声明的外部键名为准，不叠加底层转换层。
- **键存在性与缺键默认值（`.optional` / `.required` / `.default`）**：重复调用 `.optional()` 或 `.required()` 保持幂等；`.default(provider)` 仅在父对象解码缺少外部键时填入业务默认值（`InferDTO` 中该键可选，`InferData` 中该键必填，编码时正常写出该值；非原始可变值必须通过工厂函数 `() => value` 提供以防实例间共享同一引用）。
- **属性修饰换序等价**：进入属性态后，同一字段上的 `.alias(name)`、`.optional()` / `.default(...)` 与字面量扩展 `.or(...)` 互换调用顺序得到相同的静态类型与运行时行为。

### 缺键与特殊值的正交矩阵

父模型负责判断属性键是否存在，字段内部的 `Codec` 负责校验已存在键的值。两者互不混同。

以 `SKU = string({ trim: true, minLength: 1 })` 为例：

| 字段声明                       | `{}`         | `{ sku: null }` | `{ sku: undefined }` |
| ------------------------------ | ------------ | --------------- | -------------------- |
| `SKU.nullable()`               | 报缺键错误   | 保留 `null`     | 报类型错误           |
| `SKU.or(undefined)`            | 报缺键错误   | 报类型错误      | 保留键与 `undefined` |
| `SKU.optional()`               | 省略该键     | 报类型错误      | 报类型错误           |
| `SKU.optional().or(undefined)` | 省略该键     | 报类型错误      | 保留键与 `undefined` |
| `SKU.default("N/A")`           | 填入 `"N/A"` | 报类型错误      | 报类型错误           |

## 对象模型读写契约

### 定义期约束与批量别名策略

- 模型仅收集字段表中自有、可枚举的字符串键（数字属性名按语言规范转为字符串，符号键忽略）。
- 可通过 `defineModel({ alias, fields })`（如 `snakeCase`、`kebabCase` 或 `defineAlias`）对未显式绑定 `.alias(...)` 的字段统一推导外部键别名，编译期模板字面量类型与运行期键映射严格一致；单字段显式声明的 `.alias(...)` 优先级高于模型级 `alias`。
- 同一模型内所有字段解析后的外部键名必须唯一，重复时 `defineModel` 立即抛出 `RangeError`。
- `"__proto__"` 可安全用作内部业务键或外部 DTO 键（对象字面量中使用计算属性名 `["__proto__"]`）。

### 解码外部输入

1. 输入须为原型等于所属上下文 `Object.prototype` 或 `null` 的普通对象；数组、`null`、`Date`、`Map` 及自定义 `class` 实例均报 `type.object`。
2. 仅按声明读取输入的自有属性（`Object.hasOwn`），未声明的外部属性在此处剥离。
3. 所有字段均通过校验后，以 `Object.defineProperty` 将结果定义为新对象上的可枚举自有数据属性，再交由工厂构造最终输出。
4. 解码错误路径按外部键名与数组下标组织。

### 编码业务对象

基础模型与工厂派生模型共用同一套字段读取协议：

1. 输入须为非空、非数组的对象，否则报 `type.object`。
2. 对每个声明字段，优先读取对象自身的同名自有属性。
3. 缺少自有属性时，沿原型链向上查找最近的同名属性描述符，并在内建 `Object.prototype` 之前停止：
   - 若最近描述符具有可读 `get` 访问器，以当前对象为 `this` 调用一次并采用其返回值；
   - 若最近描述符是数据属性、方法或仅有 `set` 访问器，它会遮蔽更上层的 getter，按字段缺失处理。
4. 读取到的值（含 getter 返回的 `undefined`）交由字段 `Codec` 校验与编码，并以自有数据属性写入新 DTO 的外部键名。
5. 编码错误路径按模型业务键名与数组下标组织。

### 结构内省、派生与多态联合

- **只读字段表内省（`model.fields`）**：模型暴露冻结的自有可枚举字符串键字段表，保留各字段的原始 `Codec` 或 `Field` 描述符（含模型级 `alias` 策略绑定后的外部键别名）。
- **结构派生（`pick` / `omit` / `partial` / `extend`）**：`pick` 与 `omit` 基于原字段表裁剪子模型；`partial(...keys?)` 将全部或指定字段转为单层可选键（同时清除创建期的缺键默认值以防局部更新误覆盖）；`extend` 追加或按同名键覆写字段并在定义期重新校验外部键名唯一性。结构变更后的派生模型统一恢复为纯数据输出。
- **跨字段校验路径自动翻译（`Model.check`）**：对模型调用 `.check(...)` 并通过 `context.issue({ path: ["fieldName"], ... })` 指定声明字段路径时，解码阶段自动将首段翻译为该字段的外部 DTO 键名，编码阶段保持模型业务键名。
- **按标签分发的多态联合（`taggedUnion`）**：要求各分支模型均声明同一必填字面量判别键（由 `oneOf` 或 `literal` 定义，且映射至一致的外部键名）。解码按外部判别键 $O(1)$ 查表分发；编码通过自有属性或原型链 getter 读取业务判别键并分发到对应分支。

### 工厂派生与所有权

- `Model.withFactory(fn)` 基于原字段契约派生新模型，仅替换最终构造步骤；连续调用 `withFactory(f).withFactory(g)` 时以 `g` 替换 `f`，回调始终接收基础字段数据 `Data`。
- 对象模型与数组在编解码时均生成新容器；`InferData` 的字段标记为静态 `readonly` 类型，运行时不对值执行隐式深度冻结。

## 日期时间契约

`isoDateTime()` 以原生 `Date` 表达毫秒精度的确定时间点：

- **解码格式**：要求完整日期、`T`、时分秒与显式时区偏移（`Z` 或 `-23:59` 至 `+23:59`）；年份支持四位数字或带正负号的六位扩展年份（拒绝 `-000000`）。
- **日历与范围校验**：先按输入字面值校验公历闰年与月日合法性，再将亚毫秒小数截断为毫秒并按偏移换算为 UTC；超出原生 `Date` 可表示范围（距 Unix 纪元超过 `±8_640_000_000_000_000` 毫秒）时报 `datetime.out_of_range`。
- **编码格式**：通过 `Date.prototype.toISOString` 统一输出毫秒精度的 UTC 字符串（`0000`–`9999` 年输出四位年份，其余范围输出带符号六位年份），确保任意有效 `Date`（含跨上下文实例与自定义子类）均可无损往返。
