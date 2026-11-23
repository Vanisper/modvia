# Modvia 架构与包规划

Modvia 以双向编解码契约为底座，围绕应用数据边界组织校验、结构映射与领域建模。本文定义项目的分层边界、包拓扑、模块归纳准则与文档分工。

## 分层模型

核心能力自底向上按单向依赖划分为五层，下层不感知上层概念：

1. **基础运行时工具层（Shared Utilities）**
   - 承载零领域概念的 JavaScript 语言机制封装（如跨上下文纯对象判定、安全自有属性定义、`Object.is` 字面量去重与格式化）。
   - 按细粒度主题拆分模块，不设聚合入口，不感知任何编解码或模型概念。
2. **编解码内核（Codec Core）**
   - 定义双向转换协议 `CodecLike<T, E>`、标准实例 `Codec<T, E>` 与具名槽位绑定描述符 `Field`。
   - 提供零异常栈开销的内部问题收集器，统一支撑强契约编解码（`decode` / `encode` 与 `safeDecode` / `safeEncode`）及面向未知边界的解析/输出（`parse` / `dump` 与 `safeParse` / `safeDump`），并原生实现 `StandardSchemaV1`（`~standard`）。
3. **原子标量与值级算子（Codec Scalars & Operators）**
   - **原子层（Scalars）**：构建字符串、有限数字、布尔值、枚举/字面量及 ISO 日期时间等基础规则。
   - **算子层（Operators）**：构建数组、动态字典等值容器，以及管道串联、方向反转、惰性递归与顺序联合等高阶组合子；原子层与算子层平级互不依赖，均单向依赖内核层。
4. **领域模型内核（Model Core）**
   - 组合字段表形成对象级双向契约，负责外部键唯一性检查、字段内省、结构派生（`pick` / `omit` / `extend`）、工厂实例化（`withFactory`）以及原型链公开 getter 投影。
5. **领域模型算子（Model Operators）**
   - 基于模型内核构建多模型高阶组合能力（如按共有字面量标签 $O(1)$ 分发的多态联合 `taggedUnion`）。

## 包拓扑与跨包复用策略

工作区采用「单核心包多子路径 + 独立生态适配包」的拓扑结构：

- **`modvia`（位于 `packages/modvia`）**：唯一零依赖核心包，对外提供三个职责分明的模块入口：
  - `modvia/codec`：导出编解码内核、只读结构反射 `inspectCodec`、原子标量与值级算子，面向仅需纯粹双向编解码的场景。
  - `modvia/formats`：导出按需 Tree-shaking 的无依赖标准格式与协议编解码器（`uuid`、`email`、`url`、`ipv4`、`ipv6`、`isoDate`、`isoTime`、`jsonString`、`jsonOf`），单向依赖 `codec` 层且不进入主入口包体积。
  - `modvia`：汇总导出 `modvia/codec` 全部公共能力，并导出领域模型层的 `defineModel`、`alias` 策略、类型提取工具与多态模型算子。
- **生态适配与元 Schema 导出包**：
  - 凡涉及第三方校验库、元 Schema 导出或框架特定集成的能力，均在独立包中通过 `peerDependencies` 承接，不进入 `packages/modvia`。
  - `@modvia/json-schema`（位于 `packages/json-schema`）：零外部依赖读取 `inspectCodec` 只读描述符，按 DTO / Data 双视角导出 Draft-2020-12、Draft-07、OpenAPI 3.0 Schema，并提供 `StandardJSONSchemaV1` 协议包装 `withJsonSchema`。
  - `@modvia/zod`（位于 `packages/zod`）：基于 `zod/v4/core` 将对称 Zod Schema 与双向 `z.codec` 桥接为标准 `Codec`，并在编译期与定义期拦截单向 `.transform()`、隐式 `z.coerce.*` 与吞错 `.catch()`。
- **多包共享工具演进策略**：
  - 单产品包阶段，无领域工具置于 `packages/modvia/src/shared/` 并由静态规则锁定边界。
  - 当引入第二个领域包需要跨包复用基础工具时，将 `src/shared/` 原样上提为工作区私有源码包 `packages/shared`（`@modvia/shared`，`"private": true`），各领域包通过 `devDependencies` 引用并在 `vp pack` 构建期内联打包，确保发布的 npm 包始终保持零运行时依赖。

## 源码与测试目录结构

`packages/modvia/src` 在两大领域模块内部按 `core / scalars / operators` 对称归类，子目录内部不设中间 `index.ts` 转出文件，仅由最外层包入口汇总公开模块：

```text
packages/modvia/src/
├── index.ts                      # 主入口（"modvia"）：汇总 codec 与 model 公开模块
├── shared/                       # 零领域基础工具层（严禁导入 codec / model）
│   ├── object.ts                 # [内部] 跨上下文纯对象判定与安全自有属性写入
│   └── value.ts                  # [内部] 原始字面量判定、Object.is 去重与文本格式化
├── codec/                        # 编解码领域模块（严禁导入 model）
│   ├── index.ts                  # 子入口（"modvia/codec"）：汇总 codec 公开模块
│   ├── core/                     # 编解码内核（严禁导入 scalars / operators / formats）
│   │   ├── types.ts              # [公开] Codec / Field / CodecDescriptor / SafeResult / StandardSchemaV1
│   │   ├── errors.ts             # [公开] ValidationError 与 isValidationError
│   │   ├── define.ts             # [公开] defineCodec、inspectCodec、field 与 isField
│   │   ├── collector.ts          # [内部] 零异常栈开销 IssueCollector 与中断信号
│   │   └── runtime.ts            # [内部] Codec/Field 实例构造、描述符挂载与执行调度器
│   ├── scalars/                  # 原子值编解码器（严禁导入 operators）
│   │   ├── primitives.ts         # [公开] string、number、int、boolean、unknown、oneOf、literal
│   │   └── datetime.ts           # [公开] isoDateTime（独立维护日历与时区换算逻辑）
│   └── operators/                # 高阶容器与组合算子（严禁导入 scalars）
│       ├── containers.ts         # [公开] arrayOf、recordOf、tupleOf
│       ├── combinators.ts        # [公开] pipe、invert、lazy、unionOf
│       └── standard.ts           # [公开] StandardSchemaV1 同步输入桥接 fromStandard
├── formats/                      # 按需格式规则子模块（"modvia/formats"，单向依赖 codec）
│   ├── index.ts                  # 子入口（"modvia/formats"）：汇总标准格式与 JSON 桥接原语
│   ├── identifiers.ts            # [公开] uuid、email
│   ├── network.ts                # [公开] url、ipv4、ipv6
│   ├── temporal.ts               # [公开] isoDate、isoTime
│   └── json.ts                   # [公开] jsonString、jsonOf
└── model/                        # 领域模型模块（单向依赖 codec + shared，严禁导入 formats）
    ├── core/                     # 模型内核（严禁导入 model/operators）
    │   ├── types.ts              # [公开] Model 接口、字段表静态布局与类型提取工具
    │   ├── alias.ts              # [公开] 编译期与运行期同步的字段批量别名策略（snakeCase、kebabCase、defineAlias）
    │   ├── define.ts             # [公开] defineModel、字段内省、结构派生与工厂派生
    │   └── fields.ts             # [内部] 字段解析、外部键去重与原型链 getter 读取
    └── operators/                # 多模型高阶组合算子
        └── tagged-union.ts       # [公开] 按共有判别字段分发的 taggedUnion
```

测试目录 `packages/modvia/tests/` 采用同构镜像划分（`shared/`、`codec/`、`model/` 及顶层包出口冒烟测试 `artifact.test.ts`）。根级 `vite.config.ts` 通过 `no-restricted-imports` 静态守卫自动看守上述全部层级与平级子域的导入边界。

## 文档体系分工

仓库文档按受众与抽象层级分离职责，避免多处重复维护同一细节：

- [README.md](../README.md)：仓库概览、核心特性、最小示例与工作区命令导航。
- [AGENTS.md](../AGENTS.md)：面向协作者与自动化代理的工程红线、分层约束与工具链操作事实。
- `docs/architecture.md`（本文）：整体分层架构、包边界、目录归纳与演进路线。
- [docs/design.md](./design.md)：正向语义规范，阐明编解码契约、组合代数、作用域边界与对象读写不变量。
- [packages/modvia/README.md](../packages/modvia/README.md)：面向使用者的核心与 `modvia/formats` API 参考、场景示例与错误码速查表。
- [packages/json-schema/README.md](../packages/json-schema/README.md)：`@modvia/json-schema` 双视角 Schema 导出与 `StandardJSONSchemaV1` 对接说明。
- [packages/zod/README.md](../packages/zod/README.md)：`@modvia/zod` 双向桥接用法与可逆性守卫说明。

## 演进路线

1. **阶段一：分层底座与校验引擎收敛**（已完成）
   - 建立 `modvia/codec` 与 `modvia` 双入口、零异常栈收集引擎、强契约 `decode`/`encode` 与宽边界 `parse`/`dump` 2×2 执行矩阵、`StandardSchemaV1` 以及 `Codec` / `Field` 作用域隔离。
2. **阶段二：值组合原语、范围约束与精化规范体系补齐**（已完成）
   - 确立跨表示变形、同类型规范化（`normalize`）与对称精化/品牌（`refine` / 多错 `check` / `brand`）三分体系，补齐标量与数组范围/正则约束及 `modvia/formats` 按需格式库，落地 `pipe`、`invert`、`lazy`、`literal`、`int`、`unknown`、`tupleOf`、`unionOf`、`recordOf` 与零依赖 `fromStandard`。
3. **阶段三：模型结构内省、派生与多态联合**（已完成）
   - 公开只读字段表元数据与 `inspectCodec` 结构描述符，支持 `Field.default`、`pick` / `omit` / `partial` / `extend` 模型派生、批量键别名策略（`snakeCase` / `kebabCase` / `defineAlias`）、跨字段路径翻译与按标签分发的 `taggedUnion`。
4. **阶段四：生态桥接与静态 Schema 导出**（已完成）
   - 在独立包 `@modvia/json-schema` 中提供 DTO / Data 双视角 JSON Schema / OpenAPI 3.0 导出与 `StandardJSONSchemaV1` 适配；在 `@modvia/zod` 中提供 Zod v4 到 Modvia `Codec` 的双向互操作适配；后续视多领域包需要上提 `@modvia/shared` 私有源码包。
