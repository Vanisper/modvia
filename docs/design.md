# Modvia 语义与设计规范

Modvia 工作在 TypeScript 应用的数据边界：接入层将不可信的外部输入解码为业务值，写出层按同一份声明将业务值编码回 DTO。本文定义核心抽象的语义契约与执行不变量。

## 双向收敛与操作三分原则

所有编解码操作严格划分为三类互不越界的原语，共同维持「合法业务值往返收敛（`decode(encode(t)) ≡ t`）」的核心不变量：

- **跨表示变形（Morph，`E ↔ T`）**：改变值的外部与内部表示（如 `string ↔ Date`、`string ↔ number`、`DTO ↔ 领域实体`），必须显式声明正向 `decode` 与反向 `encode`（如 `Codec.define`、`Codec.pipe`），禁止引入破坏编码可逆性的单向转换或隐式宽泛强转。
- **同类型规范化（Normalize，`T → T`）**：不改变类型，仅将合法值投影至幂等规范形态（如 `.normalize(s => s.toLowerCase())`、空白裁剪、UTC 归一化）；解码与编码两端共同保证输出处于同一规范形态。
- **域内精化与品牌（Refine / Check / Brand，`T ⊇ SubT`）**：不改写值，仅收窄合法值子集（`.refine`、`.check`）或附加零运行时开销的编译期名义标签（`.brand`）；精化约束在入口解码与出口编码两端对称执行，防止非法状态流入领域层或流出至外部协议。
- **双端类型诚实性准则**：`Codec<T, Encoded>` 的外部泛型 `Encoded` 必须精确对应合法外部表示的最小静态类型；仅当外部槽位本身允许任意动态形态（如 `unknown()` 及其品牌/精化派生）时 `Encoded` 才为 `unknown`，禁止将具有确定外部形态的规则宽泛声明为 `unknown` 而导致反向输出发生静态类型失忆。

## 核心抽象、主体命名空间与作用域

系统由四个渐进接口与对应的主体命名空间构成：

| 接口 / 主体                     | 所属作用域   | 职责与静态操作                                                                                                                                            |
| ------------------------------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CodecLike<T, E>`               | 值级协议     | 最小双向协变协议，正反两端均接收 `unknown` 做运行时防御并分别产出 `T` 与 `E`，供自定义对象直接接入。                                                      |
| `StandardCodec<T, E>`           | 协变标准协议 | 含协变执行方法（`parse` / `dump` / `safe*`）与 `StandardSchemaV1` 的标准协议，供描述符与生态适配包协变接收任意具体 Codec 或 Model。                       |
| `Codec<T, E>`                   | 值级主体     | 标准双向编解码器与元操作命名空间（`Codec.define`、`Codec.inspect`、`Codec.extendStandard`、`Codec.pipe`、`Codec.invert`、`Codec.lazy`、`Codec.union`）。  |
| `Field<T, E, Source, Presence>` | 对象属性级   | 对象属性槽位描述符（实现纯数据协变协议 `FieldLike`，承载槽位级 `source`、`presence`、`description`、`fallback` 与 `codec`）；静态提供 `Field.of` / `is`。 |
| `Model<Data, DTO, Out>`         | 领域模型级   | 组合字段表形成对象契约（本身亦是 `Codec<Out, DTO>`）；静态提供 `Model.define` 与 `Model.union`，键映射策略归属 `Alias` 命名空间。                         |

内置 0 阶标量（`string`、`number`、`int`、`bigint`、`boolean`、`literal`、`unknown`、`isoDateTime`）与 1 阶值容器（`arrayOf`、`tupleOf`、`recordOf`）作为高频数据形态构造器直接导入，与 `Codec.*` 组合算子及 `Model.define` 统一返回标准 `Codec`：

- 有序数值与布尔原始标量（`number`、`int`、`bigint`、`boolean`）默认以原生类型作为外部编码介质，并统一提供 `.fromString()` 切换为严格收敛的字符串外部表示（可与数值区间方法按任意顺序交换调用；`boolean().fromString()` 进一步解锁 `.tokens(truthy, falsy)` 与 `.caseSensitive()`）。
- 任意 `Codec`（包括嵌套 `Model`）都可直接调用 `.alias(name)`、`.optional()` 或 `.default(...)` 跃迁为 `Field`，无需额外包装函数。
- 值级容器与组合子（`arrayOf`、`tupleOf`、`recordOf`、`Codec.pipe`、`Codec.invert`、`Codec.lazy`、`Codec.union`）仅接受值级 `Codec` 或裸 `CodecLike`，在编译期与定义期同时拒绝带键绑定元数据的 `Field`。
- 若需复用已有 `Field` 的底层值规则作为容器元素，可通过 `field.codec` 显式取回纯值级 `Codec`。

## 执行模型与 2×2 边界协议

消费端执行接口按「方向（正向 / 反向）× 编译期入参状态（已知契约 / 未知 `unknown`）」构成正交的 2×2 矩阵，并共享同一套零异常栈 `IssueCollector` 调度内核：

| 方向            | 强契约原语（编译期锁死两端静态类型）           | 动态边界门面（编译期放宽入参为 `unknown`）        |
| --------------- | ---------------------------------------------- | ------------------------------------------------- |
| 正向（外 → 内） | `decode(input: E): T` / `safeDecode(input: E)` | `parse(input: unknown): T` / `safeParse(unknown)` |
| 反向（内 → 外） | `encode(value: T): E` / `safeEncode(value: T)` | `dump(input: unknown): E` / `safeDump(unknown)`   |

- **`decode` / `encode`**：在编译期校验上下游已知类型契约并提供属性补全，运行时仍执行完整的零信任校验。
- **`parse` / `dump`**：面向编译期未知或动态来源（如原始网络载荷、未定型表单草稿、通用缓存/消息中间件），运行时验明正身并转换。
- **抛错与安全结果对偶**：`safeDecode`、`safeEncode`、`safeParse` 与 `safeDump` 直接返回冻结的判别联合 `SafeResult<T>`，全程不构造 `Error` 实例；普通方法仅在顶层出口一次性构造并抛出 `ValidationError`（可通过 `ValidationError.is(err)` 跨上下文识别）。
- **执行方法可解构，构建方法基于原型与 `this`**：2×2 执行方法（`decode` / `encode` / `parse` / `dump` 及其 `safe*` 变体）在构造期绑定，允许直接解构或作为回调传入（如 `items.map(User.parse)`）；链式构建方法（`.refine` / `.min` / `.alias` / `.pick` 等）挂在浅层内部类原型上并依赖 `this`，对外仅暴露 `interface` 契约，不提供 `instanceof` 保证。
- 自定义底层规则（`Codec.define` / `CodecLike`）在正反两端均须校验 `unknown` 输入，可通过 `context.issue({ code, message, path?, params? })` 无抛错记录问题并返回不透明 `Failed` 标记（既可单行 `return context.issue(...)` 零异常退出，也可连续调用收集多条错误），通过 `context.fail(code, message, params?)` 从深层辅助函数或 `.check` 立即中断当前规则，或通过按方向分型的 `context.run(child, input, at?)` 在同一收集器与路径下组合子 Codec（失败返回 `Failed` 并须经 `context.failed(v)` 收窄；handler 执行期间只要记录过问题，其返回值即丢弃并判为失败；返回 `Failed` 却未记录任何问题时抛 `TypeError`）；其他普通运行时异常原样向外传播。
- **回调期 context 生命周期**：每次顶层调用独占一个问题收集器（不做跨调用池化复用）；传入 `Codec.define` handler 与 `.check` 回调的 `context` 为轻量原型类实例（原型冻结且每次回调独立实例化），通过私有关闭标志守卫生命周期，回调返回后再调用 `fail` / `issue` / `run` 立即抛错，杜绝逃逸 context 向其他调用写入问题。
- **内部协议私有化**：成对执行内核（`{ decode, encode }`）、失败哨兵与内部注册表均完全模块私有，跨副本或跨版本互操作只经由公开协议（`CodecLike`、`FieldLike`、`StandardSchemaV1` 与 `ValidationError.is`）。
- **执行内核与只读结构描述符分离**：运行时校验始终直接执行成对函数闭包，不经过 AST 解释器；内置标量、容器、组合子、模型与 `modvia/formats` 构造时同步挂载冻结的 `CodecDescriptor`（可通过 `Codec.inspect(codec)` 读取，支持 `.describe(text)` 附加静态文档说明；`.refine` / `.check` / `.normalize` 诚实包裹为扁平合并的 `kind: "refined"` 节点保留内层结构与精化步骤；静态字面量与模型路径映射均直接从描述符推导），供独立包 `@modvia/json-schema` 按 DTO 或 Data 视角导出 JSON Schema 与 OpenAPI 规范。
- 所有值级 `Codec` 与 `Model` 均原生实现 `StandardSchemaV1`（`"~standard"`），并可通过 `Codec.extendStandard(codec, extension)` 派生同构实例挂载 Standard Schema 族扩展（如 `@modvia/json-schema` 的 `StandardJSONSchemaV1`，扩展只属于返回实例，在其上继续派生的新定义不继承）；外部校验生态向 Modvia 的双向接入统一由专用适配包（如 `@modvia/zod`）承接。

## 组合代数、信息维度与三阶单向跃迁

### 三类信息维度与顺序性质

编解码链式操作按代数性质严格区分为三类，消除「何时顺序无关、何时顺序决定语义」的歧义：

- **同阶配置状态（State，顺序无关）**：同一作用域实例内部的正交配置槽位（如 `string` 的 `trim / minLength / maxLength / pattern`、有序数值的上下界与 `.fromString()`、`Field` 的 `source / presence`、`Model` 的 `strict / withFactory` 及自定义 `Codec.define` 的 `state`）。同阶内不同槽位调用顺序完全可交换，同一槽位重复声明按后写覆盖，内核始终按满足收敛律的固定顺序（先规范化再精化）执行。
- **静态描述元数据（Meta `description`，同阶可交换、跨层守界）**：零运行时开销的文档说明槽位，在 `Codec`、`Field` 与 `Model` 各自所属层级独立存储且与同阶全部配置方法换序等价。跨结构组合（如 `arrayOf(item)`、`Codec.union`、在值级将基础类型包裹进 `.or(...)`）时，内层 `description` 描述分支或元素，外层 `description` 描述复合结构；而在进入 `Field` 槽位阶后，`field.describe(text)` 始终写入属性槽位自身的 `field.description`（与 `alias / optional / default / or` 完全顺序无关，且不克隆底层 `field.codec`）。
- **因果变换管道（Pipeline，顺序即语义）**：通用闭包与结构包裹算子（`.normalize`、`.refine`、`.check`、`.or` / `.nullable`、`.pipe`）构成由内向外的洋葱管道，调用先后直接表达逻辑因果关系（唯一例外为相邻 `.or(a).or(b)` 按字面量集合并集自动扁平合并并保留外层 `description`）。

### 三阶单向跃迁

每次调用修饰方法均返回冻结的新定义，链式调用按职责边界遵循由内向外的**三阶单向跃迁**，不提供黑盒交集算子（`.and()`）或逆向剥壳算子（`.unwrap()`）：

1. **第一阶：特征派生阶（`WithCodecTrait`）**：承载内置有参原语与状态化 `Codec.define` 的结构化配置，内部细分为两类操作：
   - **值域特征方法**：仅约束或规范化业务值而不改变外部类型 `Encoded`（如 `.min()`、`.trim()`、`.nonEmpty()`、`.tokens()`、`.protocols()`）；通过 `.pipe()`、`Codec.pipe()` 或 `jsonOf()` 串联上游时，直接将上游写入下游族实例的上游槽位（无需方法转发），自动保留下游全部值域方法并将外部类型重绑为上游 `Encoded`。
   - **根实例派生方法**：原始标量的 `.fromString()` 仅存在于无上游的根实例原型上（数值族将十进制文本 Codec 接入上游槽，布尔族切换至布尔文本族），在未绑定上游管道前与区间方法、`describe` 均换序等价；切换完成或接入上游管道后在静态类型与运行期原型上同步收敛消失。
   - **状态化定义契约**：`Codec.define({ state, validate?, decode, encode, descriptor?, methods })` 要求 `state` 为普通对象，正反两端统一通过 `ctx.state` 读取冻结状态，`methods` 返回 `Partial<S>` 增量补丁或 `(prev) => Partial<S>` 演进函数；规范化（如 `trim`）在内核中始终先于范围守卫执行，空区间与保留字冲突在定义期立即拦截。
2. **第二阶：通用值级阶（`Codec`）**：一旦调用黑盒闭包或值域扩张算子（`.refine`、`.check`、`.normalize`、`.brand`、`.or`、`.nullable`），静态类型单向收敛为标准 `Codec<T, Encoded>`，防止后续重建底层状态覆盖已挂载谓词或抹除品牌类型；纯静态文档 `.describe(text)` 在各阶均保持原阶类型不变。
3. **第三阶：对象槽位阶（`Field`）**：调用 `.alias`、`.optional` 或 `.default` 后跃迁为属性描述符，绑定父对象的外部键映射与缺键策略，编译期与运行期禁止逆向混入值级容器。

通用组合算子遵循以下执行不变量：

- **管道包裹与路径复合（`.check` / `.pipe`）**：`.check(rule)` 在基础 `Codec` 通过后对业务值执行对称约束，双端均由内向外执行；`Codec.pipe(first, second)` 解码按 `first → second` 正向传递，编码按 `second → first` 逆向传递，并按函子复合规则透传字段路径映射器（例如对 `jsonOf(Model)` 追加 `.check` 时，解码错误路径仍自动映射为外部 DTO 键名）。`pipe` 面向跨表示阶段串联；同类型约束归并应优先使用原语链式方法或 `.normalize() / .refine()`，以确保静态 Schema 反射完整保留双端约束。
- **字面量哨兵优先（`.or` / `.nullable`）**：接受一个或多个原始字面量（`string | number | boolean | null | undefined`），编解码两端均先按 `Object.is` 短路匹配字面量，未命中时再交由当前内部 `Codec` 处理。连续相邻调用 `.or(a).or(b)` 与单次调用 `.or(a, b)` 等价，内部自动扁平化合并并保留已声明的外层 `description`；与 `.check` 交错时严格遵循外层包裹内层的洋葱顺序。
- **不相交域多分支联合（`Codec.union`）**：按参数顺序依次尝试分支，首个无错误返回的分支胜出并回滚前序分支的试探记录，全部失败时报 `union.no_match`。仅适用于外部编码域与内部业务域均互不相交的异构类型联合（如 `Date | number`）；对象多态场景须使用按判别键 $O(1)$ 分发的 `Model.union` 以守住往返收敛律与精确错误路径。
- **方向反转与惰性引用（`Codec.invert` / `Codec.lazy`）**：`Codec.invert` 对调 `decode` 与 `encode` 方向；`Codec.lazy` 将目标 `Codec` 的求值推迟到首次运行并缓存解析结果，支持自引用递归结构。
- **动态字典容器（`recordOf`）**：接受纯对象输入，逐个自有可枚举键执行键与值的双向转换；若键转换后产生同名碰撞则报 `record.duplicate_key`。
- **外部键别名重绑覆盖（`.alias`）**：多次调用 `.alias("a").alias("b")` 以最后一次声明的外部键名为准，不叠加底层转换层。
- **键存在性与缺键默认值（`.optional` / `.required` / `.default`）**：重复调用 `.optional()` 或 `.required()` 保持幂等；`.default(provider)` 仅在父对象解码缺少外部键时填入业务默认值（`InferDTO` 中该键可选，`InferData` 中该键必填，编码时正常写出该值；非原始可变值必须通过工厂函数 `() => value` 提供以防实例间共享同一引用）。
- **槽位级修饰顺序无关性**：进入 `Field` 阶后，同一属性槽位上的 `.describe(text)`、`.alias(name)`、`.optional()` / `.required()` / `.default(...)` 与 `.or(...)` / `.nullable()` 修改的是各自正交的槽位属性，互换调用顺序均产出一致的静态类型、运行时行为与外层属性 `description`。

### 缺键与特殊值的正交矩阵

父模型负责判断属性键是否存在，字段内部的 `Codec` 负责校验已存在键的值。两者互不混同。

以 `SKU = string().trim().nonEmpty()` 为例：

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
- 可通过 `Model.define({ alias, fields })`（如 `Alias.snakeCase`、`Alias.kebabCase` 或 `Alias.define`）对未显式绑定 `.alias(...)` 的字段统一推导外部键别名，编译期模板字面量类型与运行期键映射严格一致；单字段显式声明的 `.alias(...)` 优先级高于模型级 `alias`。
- 同一模型内所有字段解析后的外部键名必须唯一，重复时 `Model.define` 立即抛出 `RangeError`。
- `"__proto__"` 可安全用作内部业务键或外部 DTO 键（对象字面量中使用计算属性名 `["__proto__"]`）。

### 解码外部输入

1. 输入须为原型等于所属上下文 `Object.prototype` 或 `null` 的普通对象；数组、`null`、`Date`、`Map` 及自定义 `class` 实例均报 `type.object`。
2. 默认仅按声明读取输入的自有属性（`Object.hasOwn`），未声明的外部属性在此处剥离；若模型经过 `.strict()` 派生，则遇到未声明的自有可枚举属性时在对应外部键路径报告 `object.unknown_key`。
3. 各声明字段通过校验后写入新对象的可枚举自有数据属性（常规键直接赋值，`"__proto__"` 或原型链同名键通过 `Object.defineProperty` 安全定义），全部字段与严格边界校验通过后再交由工厂构造最终输出。
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

- **只读字段表内省（`model.fields`）**：模型暴露冻结的自有可枚举字符串键字段表，保留各字段的原始 `Codec` 或 `Field` 描述符（含模型级 `alias` 策略在定义期快照绑定后的外部键别名）。
- **字段表结构派生（`pick` / `omit` / `partial` / `extend`）**：基于已绑定别名的字段表派生新数据模型，自动继承原模型的 `strict` 边界策略（与 `.strict()` 换序等价），同时重置 `withFactory` 与外层 `description`；`partial(...keys?)` 将指定或全部字段转为单层可选键并清除创建期缺键默认值；`extend` 新增或覆写的字段按其自身 `.alias()` 声明解析外部键，并在定义期重新校验外部键唯一性。
- **单层严格边界与文档派生（`strict` / `describe`）**：`.strict()` 仅约束当前模型自身的单层未知键边界（不递归侵入嵌套子模型字段，保护子契约独立封装），与 `.describe(text)` 均完整保留原字段契约与 `withFactory` 实例构造工厂。
- **跨字段校验路径自动翻译（`Model.check`）**：对模型调用 `.check(...)` 并通过 `context.issue({ path: ["fieldName"], ... })` 指定声明字段路径时，解码阶段自动将首段翻译为该字段的外部 DTO 键名，编码阶段保持模型业务键名。
- **按标签分发的多态联合（`Model.union`）**：要求各分支模型均声明同一必填字面量判别键（由 `literal` 定义，且映射至一致的外部键名；经 `.refine` / `.check` / `.normalize` 包裹后不再视为静态判别键）。解码按外部判别键 $O(1)$ 查表分发；编码通过自有属性或原型链 getter 读取业务判别键并分发到对应分支。

### 工厂派生与所有权

- `Model.withFactory(fn)` 基于原字段契约派生新模型，仅替换最终构造步骤；连续调用 `withFactory(f).withFactory(g)` 时以 `g` 替换 `f`，回调始终接收基础字段数据 `Data`。
- 对象模型与数组在编解码时均生成新容器；`InferData` 的字段标记为静态 `readonly` 类型，运行时不对值执行隐式深度冻结。

## 原始标量介质切换与日期时间契约

### 原始标量 `.fromString()` 收敛规则

- **数值与大整数（`number` / `int` / `bigint`）**：解码拒绝空串、首尾空白、非数字后缀及越界文本（`int` 仅接受十进制安全整数文本，`number` 接受十进制与科学计数法有限浮点数文本，`bigint` 仅接受十进制整数文本）；`-0` 与 `"-0"` 统一归一为规范零值 `0` 与 `"0"`，确保 `decode(encode(v)) ≡ v`。
- **布尔文本（`boolean().fromString()`）**：默认大小写不敏感匹配 `"true"` / `"false"` 并编码写出小写首词；通过 `.tokens(truthy, falsy)` 自定义非空不交叠词表时，输入词表在定义期防御性拷贝冻结，编码始终收敛至各自首词。

### 日期时间契约

`isoDateTime()` 以原生 `Date` 表达毫秒精度的确定时间点：

- **解码格式**：要求完整日期、`T`、时分秒与显式时区偏移（`Z` 或 `-23:59` 至 `+23:59`）；年份支持四位数字或带正负号的六位扩展年份（拒绝 `-000000`）。
- **日历与范围校验**：先按输入字面值校验公历闰年与月日合法性，再将亚毫秒小数截断为毫秒并按偏移换算为 UTC；超出原生 `Date` 可表示范围（距 Unix 纪元超过 `±8_640_000_000_000_000` 毫秒）时报 `date.out_of_range`。
- **编码格式**：通过 `Date.prototype.toISOString` 统一输出毫秒精度的 UTC 字符串（`0000`–`9999` 年输出四位年份，其余范围输出带符号六位年份），确保任意有效 `Date`（含跨上下文实例与自定义子类）均可无损往返。

## 设计边界

为守住双向可逆性、作用域正交与零依赖原则，系统确立以下边界约束：

- **同步确定性执行**：所有 `Codec` 与 `Model` 均为同步纯计算，I/O 与远程存在性校验归属应用服务层。
- **显式可逆变形**：跨类型转换须同时提供正向 `decode` 与反向 `encode`，不引入单向转换或隐式宽泛强转。
- **缺键补全与值错误分离**：`.default()` 仅作用于父对象缺键场景，已存在键的值违规始终显式报告错误。
- **模型派生替代方向开关**：读写契约差异通过 `pick`、`omit`、`partial`、`extend` 派生独立模型表达，不在单字段引入读写方向开关。
- **显式动态载荷与单层可选化**：动态扩展数据须显式声明为 `unknown()` 或 `recordOf(unknown())`，局部更新可选化保持单层明确边界。
- **外部无侵入装配与稳定错误码**：领域 `class` 经由 `withFactory` 从外部构造；校验失败统一输出遵循 `<domain>.<reason>` 三层互斥规则的稳定 `issue.code`（`IssueCode`）与冻结的最小结构化 `issue.params`，供上层映射多语言文案。
