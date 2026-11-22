# Modvia 架构与包规划

Modvia 以双向编解码契约为底座，围绕应用数据边界组织校验、结构映射与领域建模。本文定义项目的分层边界、包拓扑、源码结构与文档分工。

## 分层模型

核心能力按单向依赖划分为四层，下层不感知上层概念：

1. **编解码内核（Codec Kernel）**
   - 定义双向转换协议 `CodecLike<T, E>` 与标准实例 `Codec<T, E>`。
   - 提供零异常栈开销的内部问题收集器，统一支撑抛错调用（`decode` / `encode`）与结果调用（`safeDecode` / `safeEncode`）。
   - 提供值级通用组合原语（如字面量豁免、对称校验、双向管道、方向反转、惰性递归与通用联合），并原生实现 `StandardSchemaV1`（`~standard`）。
2. **标量与值容器（Scalars & Containers）**
   - 完全基于编解码内核构建开箱即用的基础规则，包括字符串、有限数字、布尔值、枚举/字面量、ISO 日期时间，以及数组、字典等值容器。
3. **字段绑定描述符（Field Binding）**
   - 将值级 `Codec` 绑定到具名容器槽位，承载外部键名（`source`）与键缺省规则（`presence`）。
   - 值级组合与对象属性修饰在类型层面区分作用域，防止属性修饰符在数组或字典元素内静默失效。
4. **领域模型与实体投影（Domain Model）**
   - 组合字段表形成对象级双向契约，支持字段内省、结构派生（`pick` / `omit` / `extend`）与可辨识多态联合（`taggedUnion`）。
   - 默认产出普通对象；支持通过 `withFactory` 构造领域实例，并在编码时按声明字段安全投影自有属性或原型链公开 getter。

## 包拓扑与导出边界

工作区采用「单核心包多子路径 + 独立生态适配包」的拓扑结构：

- **`modvia`（位于 `packages/modvia`）**：唯一零依赖核心包，对外提供两个稳定的模块入口：
  - `modvia/codec`：导出前两层与字段描述符原语，面向仅需纯粹双向编解码的场景（如配置解析、协议转换、存储序列化）。
  - `modvia`：重导出 `modvia/codec` 全部公共能力，并导出领域模型层的 `defineModel`、类型提取工具与多态模型组合器。
- **生态适配包（如规划中的 `@modvia/zod`，位于 `packages/zod`）**：
  - 凡涉及第三方校验库、元Schema导出或框架特定集成的能力，均在独立包中通过 `peerDependencies` 承接，不进入 `packages/modvia`。

`modvia/codec` 与 `modvia` 在构建配置、公共符号和类型定义上保持完全自包含，确保未来在 `1.0` 阶段具备零破坏拆分为独立 `@modvia/codec` 包的条件。

## 源码目录结构

`packages/modvia/src` 的目录按依赖方向物理隔离：

```text
packages/modvia/src/
├── index.ts            # 主入口（"modvia"）：聚合导出 codec 层与 model 层公开模块
├── codec/              # 编解码底座层（严禁导入 ../model）
│   ├── index.ts        # 子入口（"modvia/codec"）：聚合导出 codec 公开模块
│   ├── types.ts        # 公开契约、结果类型、StandardSchemaV1 与字段接口
│   ├── errors.ts       # 公开 ValidationError 与类型守卫
│   ├── codec.ts        # 公开 defineCodec、field 与 isField
│   ├── combinators.ts  # 公开通用值组合子（pipe、invert、lazy、unionOf）
│   ├── scalars.ts      # 公开内置标量规则（string、number、boolean、oneOf、literal、isoDateTime）
│   ├── containers.ts   # 公开值容器规则（arrayOf、recordOf）
│   ├── collector.ts    # [内部] 零异常栈开销 IssueCollector 与中断信号
│   ├── runtime.ts      # [内部] Codec/Field 实例构造与执行调度器
│   └── object-utils.ts # [内部] 纯对象判定与自有数据属性定义工具
└── model/              # 领域模型层（单向依赖 ../codec）
    ├── types.ts        # 公开 Model 接口、字段表静态布局与类型提取工具
    ├── model.ts        # 公开 defineModel、字段内省、结构派生与工厂派生实现
    ├── union.ts        # 公开按共有判别字段分发的多态模型组合器 taggedUnion
    └── object.ts       # [内部] 字段解析、外部键去重与原型链 getter 读取
```

根级 `vite.config.ts` 通过静态检查规则强制约束 `packages/modvia/src/codec/**` 不得导入上层 `model` 目录。

## 文档体系分工

仓库文档按受众与抽象层级分离职责，避免多处重复维护同一细节：

- [README.md](../README.md)：仓库概览、核心特性、最小示例与工作区命令导航。
- [AGENTS.md](../AGENTS.md)：面向协作者与自动化代理的工程红线、分层约束与工具链操作事实。
- `docs/architecture.md`（本文）：整体分层架构、包边界、目录组织与演进路线。
- [docs/design.md](./design.md)：正向语义规范，阐明编解码契约、组合代数、作用域边界与对象读写不变量。
- [packages/modvia/README.md](../packages/modvia/README.md)：面向使用者的 API 参考、场景示例与错误码速查表。

## 演进路线

1. **阶段一：分层底座与校验引擎收敛**
   - 建立 `modvia/codec` 与 `modvia` 双入口、零异常栈收集引擎、`safeDecode` / `safeEncode`、`StandardSchemaV1` 以及 `Codec` / `Field` 作用域隔离。
2. **阶段二：值组合原语与动态容器补齐**
   - 落地对称细化 `check`、双向管道 `pipe`、方向反转 `invert`、惰性递归 `lazy`、多类型字面量 `literal`、通用联合 `unionOf` 与字典容器 `recordOf`。
3. **阶段三：模型结构内省、派生与多态联合**
   - 公开只读字段表元数据，支持 `pick` / `omit` / `extend` 模型派生与按标签分发的 `taggedUnion`。
4. **阶段四：生态桥接扩展**
   - 在独立包 `@modvia/zod` 中提供外部 Schema 与双向 Codec 的互操作适配。
