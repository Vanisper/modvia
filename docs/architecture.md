# Modvia 架构与包规划

Modvia 以双向编解码契约为底座，围绕应用数据边界组织校验、结构映射与领域建模。本文定义项目的分层边界、包拓扑、模块归纳准则与文档分工。

## 分层模型

核心能力自底向上按单向无环依赖划分为六层，下层不感知上层概念：

1. **基础运行时工具层（Shared Utilities，`src/shared`）**
   - 承载零领域概念的 JavaScript 语言机制封装（如跨上下文纯对象判定、安全自有属性定义、`Object.is` 字面量去重与格式化）。
   - 按细粒度主题拆分模块，不设聚合入口，不感知任何标量规则、编解码或模型概念。
2. **纯标量计算原子层（Pure Computational Scalars，`src/scalars`）**
   - 承载零 `Codec` 耦合的纯数学、词法与时间计算原语：离散长度闭区间代数、通用全序开闭区间代数（连续浮点数、离散安全整数与大整数）、无状态正则复制、布尔候选词表编译以及公历闰年与 ISO 日期时间换算。
   - 不构造 `Codec` 实例、不分配错误对象，供上层容器算子、原始标量编解码器与领域格式规则跨层共享。
3. **双向编解码引擎与算子层（Codec Kernel & Operators，`src/codec`）**
   - **内核（`core`）**：定义双向协议 `CodecLike<T, E>`、标准实例 `Codec<T, E>`、特征承载体 `WithCodecTrait<T, E, Trait>` 与属性描述符 `Field`；提供零异常栈开销的 `IssueCollector`、状态化增量补丁构造机制以及 `StandardSchemaV1` 挂载。
   - **算子（`operators`）**：构建数组、元组与动态字典容器（`arrayOf` 复用 `src/scalars` 的长度区间代数），以及保留下游自有方法特征的管道串联（`pipe`）、方向反转（`invert`）、惰性递归（`lazy`）与顺序联合（`unionOf`）。
4. **原始标量与领域格式编解码层（Primitives & Domain Formats，`src/primitives` / `src/formats`）**
   - **原始标量层（`src/primitives`）**：将 `src/scalars` 的计算原子桥接至 `src/codec`，提供 `string`、`number`、`int`、`bigint`、`boolean`、`literal`、`oneOf`、`unknown` 与 `isoDateTime`，并在有序数值与布尔原语上统一内建 `.fromString()` 外部字符串介质切换。
   - **领域格式层（`src/formats`）**：按主题子目录组织互联网、标识、日历时间与 JSON 文本格式（`uuid`、`email`、`url`、`ipv4`、`ipv6`、`isoDate`、`isoTime`、`jsonString`、`jsonOf`）；`primitives` 与 `formats` 平级隔离、互不依赖。
5. **领域模型内核（Model Core，`src/model/core`）**
   - 组合字段表形成对象级双向契约，负责外部键唯一性检查、字段内省、结构派生（`pick` / `omit` / `partial` / `extend` / `strict`）、文档说明（`describe`）、工厂实例化（`withFactory`）以及原型链公开 getter 投影。
6. **领域模型算子（Model Operators，`src/model/operators`）**
   - 基于模型内核构建多模型高阶组合能力（如按共有字面量标签 $O(1)$ 分发的多态联合 `Model.union`）。

## 包拓扑与跨包复用策略

工作区采用「单核心包多子路径 + 独立生态适配包」的拓扑结构，公共符号按职责层次分离为「主体命名空间（类型与值合并）」与「直接数据形态构造器」：

- **`modvia`（位于 `packages/modvia`）**：唯一零依赖核心包，对外提供三个职责分明的模块入口：
  - `modvia/codec`（对应 `src/codec.ts`）：导出 `Codec` 与 `Field` 主体命名空间、`ValidationError`、0 阶原始标量（`string`、`number`、`int`、`bigint`、`boolean`、`unknown`、`literal`、`oneOf`、`isoDateTime`）与 1 阶值容器（`arrayOf`、`tupleOf`、`recordOf`）。
  - `modvia/formats`（对应 `src/formats.ts`）：导出按需 Tree-shaking 的无依赖领域格式与 JSON 桥接原语（`uuid`、`email`、`url`、`ipv4`、`ipv6`、`isoDate`、`isoTime`、`jsonString`、`jsonOf`），不进入主入口包体积。
  - `modvia`（对应 `src/index.ts`）：汇总导出 `modvia/codec` 全部公共能力，并导出领域模型层的 `Model` 与 `Alias` 主体命名空间及类型提取工具。
- **生态适配与元 Schema 导出包**：
  - 凡涉及第三方校验库、元 Schema 导出或框架特定集成的能力，均在独立包中通过 `peerDependencies` 承接，不进入 `packages/modvia`。
  - `@modvia/json-schema`（位于 `packages/json-schema`）：零外部依赖读取 `Codec.inspect` 只读描述符（含 `description` 与 `strict` 元数据），按 DTO / Data 双视角导出 Draft-2020-12、Draft-07、OpenAPI 3.0 Schema，并提供 `StandardJSONSchemaV1` 协议包装 `withJsonSchema`。
  - `@modvia/zod`（位于 `packages/zod`）：基于 `zod/v4/core` 将对称 Zod Schema 与双向 `z.codec` 桥接为标准 `Codec`，并在编译期与定义期拦截单向 `.transform()`、隐式 `z.coerce.*` 与吞错 `.catch()`。
- **多包共享工具演进策略**：
  - 单产品包阶段，无领域工具与纯标量计算原子分别置于 `packages/modvia/src/shared/` 与 `src/scalars/`，由静态规则锁定单向边界。
  - 当引入第二个领域包需要跨包复用底层计算工具时，可按需上提为工作区私有源码包并在 `vp pack` 构建期内联打包，确保发布的 npm 包始终保持零运行时依赖。

## 源码与测试目录结构

`packages/modvia/src` 按单向依赖层级组织目录，全部子目录内部均不设中间二次转出文件，统一由顶层三个包入口（`index.ts`、`codec.ts`、`formats.ts`）汇总公开模块：

```text
packages/modvia/src/
├── index.ts                      # 主入口（"modvia"）：汇总 codec.ts 与 model 公开模块
├── codec.ts                      # 子入口（"modvia/codec"）：汇总 codec 与 primitives 公开模块
├── formats.ts                    # 子入口（"modvia/formats"）：汇总领域格式与 JSON 桥接模块
├── shared/                       # 零领域基础工具层（不感知任何上层概念）
│   ├── object.ts                 # [内部] 跨上下文纯对象判定与安全自有属性写入
│   └── value.ts                  # [内部] 原始字面量判定、Object.is 去重与文本格式化
├── scalars/                      # 零 Codec 耦合纯标量计算原子层（仅允许依赖 shared）
│   ├── string.ts                 # [内部] 无状态正则标志位校验与克隆
│   ├── boolean.ts                # [内部] 布尔真假候选词表编译、查表与规范化写出
│   ├── temporal.ts               # [内部] 公历闰年、ISO 日期/时钟校验与 UTC 时间戳换算
│   ├── ip.ts                     # [内部] IPv4 八位组与 IPv6 零压缩/内嵌尾部纯词法判定
│   ├── bounds/
│   │   ├── length.ts             # [内部] 离散非负长度区间代数（供 string 与 arrayOf 共享）
│   │   └── ordered.ts            # [内部] 全序开闭区间判空与比较代数（连续浮点 / 离散整数 / bigint）
│   └── numeric/
│       ├── number.ts             # [内部] 有限浮点数守卫、十进制/科学计数法文本解析与格式化
│       ├── int.ts                # [内部] 安全整数守卫与十进制文本双向解析
│       └── bigint.ts             # [内部] 原生 bigint 守卫与严格十进制文本双向解析
├── codec/                        # 纯粹双向编解码引擎与算子层（严禁导入 primitives / formats / model）
│   ├── namespace.ts              # [公开] Codec 与 Field 类型-值合并命名空间
│   ├── core/                     # 编解码内核（严禁导入 operators）
│   │   ├── types.ts              # [公开] Codec / Field / FieldLike / WithCodecTrait、CodecDescriptor、StandardSchemaV1
│   │   ├── errors.ts             # [公开] ValidationError（含静态 ValidationError.is）
│   │   ├── define.ts             # [内部定义] defineCodec、inspectCodec、field 与 isField
│   │   ├── collector.ts          # [内部] 零异常栈开销 IssueCollector 与中断信号
│   │   └── runtime.ts            # [内部] Codec/Field/Trait/Pipe 实例构造与执行调度器
│   └── operators/                # 值容器与组合算子
│       ├── containers.ts         # [公开] arrayOf、recordOf、tupleOf
│       └── combinators.ts        # [内部定义] pipe、invert、lazy、unionOf（由 Codec.* 暴露）
├── primitives/                   # 原始标量编解码器层（消费 scalars + codec，严禁导入 formats / model）
│   ├── string.ts                 # [公开] string（StringCodec / StringTrait）
│   ├── boolean.ts                # [公开] boolean（含 .fromString() → BooleanStringCodec）
│   ├── literal.ts                # [公开] literal、oneOf
│   ├── unknown.ts                # [公开] unknown
│   ├── datetime.ts               # [公开] isoDateTime（复用 scalars/temporal）
│   └── numeric/
│       ├── shared.ts             # [内部] 有序数值通用工厂、OrderedNumericCodec 与 OrderedNumericTrait
│       ├── number.ts             # [公开] number（含 .fromString() 字符串介质切换）
│       ├── int.ts                # [公开] int（含 .fromString() 字符串介质切换）
│       └── bigint.ts             # [公开] bigint（含 .fromString() 字符串介质切换）
├── formats/                      # 按需领域格式子模块（消费 scalars + codec，严禁导入 primitives / model）
│   ├── email.ts                  # [公开] email（EmailCodec / EmailTrait）
│   ├── uuid.ts                   # [公开] uuid
│   ├── net/
│   │   ├── url.ts                # [公开] url（UrlCodec / UrlTrait）
│   │   ├── ipv4.ts               # [公开] ipv4（复用 scalars/ip）
│   │   └── ipv6.ts               # [公开] ipv6（复用 scalars/ip）
│   ├── temporal/
│   │   ├── iso-date.ts           # [公开] isoDate（复用 scalars/temporal 公历校验）
│   │   └── iso-time.ts           # [公开] isoTime（复用 scalars/temporal 时钟校验）
│   └── json/
│       ├── json-string.ts        # [公开] jsonString
│       └── json-of.ts            # [公开] jsonOf（保留下游 WithCodecTrait 链式方法）
└── model/                        # 领域模型模块（单向依赖 codec + shared，严禁导入 scalars / primitives / formats）
    ├── namespace.ts              # [公开] Model 类型-值合并命名空间（Model.define、Model.union）
    ├── core/                     # 模型内核（严禁导入 model/operators）
    │   ├── types.ts              # [公开] Model 接口、字段表静态布局与类型提取工具
    │   ├── alias.ts              # [公开] Alias 类型-值合并命名空间
    │   ├── define.ts             # [内部定义] defineModel、字段内省、结构/严格模式派生与工厂派生
    │   └── fields.ts             # [内部] 字段解析、外部键去重与原型链 getter 读取
    └── operators/                # 多模型高阶组合算子
        └── tagged-union.ts       # [内部定义] 按共有判别字段分发的 taggedUnion（由 Model.union 暴露）
```

测试目录 `packages/modvia/tests/` 与源码同构对应划分（`shared/`、`scalars/`、`codec/`、`primitives/`、`formats/`、`model/` 及顶层包出口测试 `artifact.test.ts`）。根级 `vite.config.ts` 通过 `no-restricted-imports` 静态守卫看守全部层级、平级子域与顶层入口的导入边界。

## 文档体系分工

仓库文档按受众与抽象层级分离职责，避免多处重复维护同一细节：

- [README.md](../README.md)：仓库概览、核心特性、最小示例与工作区命令导航。
- [AGENTS.md](../AGENTS.md)：面向协作者与自动化代理的工程红线、分层约束与工具链操作事实。
- `docs/architecture.md`（本文）：整体分层架构、包边界、目录归纳与演进路线。
- [docs/design.md](./design.md)：正向语义规范，阐明编解码契约、组合代数、作用域边界与对象读写不变量。
- [packages/modvia/README.md](../packages/modvia/README.md)：面向使用者的核心与 `modvia/formats` API 参考、场景示例与错误码速查表。
- [packages/json-schema/README.md](../packages/json-schema/README.md)：`@modvia/json-schema` 双视角 Schema 导出与 `StandardJSONSchemaV1` 对接说明。
- [packages/zod/README.md](../packages/zod/README.md)：`@modvia/zod` 双向桥接用法与可逆性守卫说明。

## 扩展准则

后续能力演进严格遵循以下架构边界：

- **新增标量计算与领域格式**：零 `Codec` 耦合的纯数学或词法判定下沉至 `src/scalars/`；通用协议级格式规则作为独立文件或主题子目录放入 `src/formats/` 并由 `src/formats.ts` 按需导出，保持主入口包体积恒定。
- **新增外部生态桥接与元协议导出**：面向其他校验库（如 Valibot、ArkType）或规范导出的集成能力一律在 `packages/*` 下建立独立包并通过 `peerDependencies` 承接，依托公开的 `Codec.inspect` 与 `Codec.define` 双向契约完成对接，不向 `packages/modvia` 引入外部依赖。
- **跨包底层工具共享**：当多领域包需要共享 `src/shared/` 或 `src/scalars/` 原子时，上提为工作区私有源码包（`"private": true`）并在 `vp pack` 构建期内联，确保发布的全部核心产物维持零运行时依赖。
