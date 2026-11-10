# Modvia

面向 TypeScript 应用的模型层基础库，核心包位于 `packages/modvia`。

## 工作原则

- 模型层保持零运行时依赖，不引入 HTTP、UI、缓存或平台耦合。
- 派生优于开关：返回新值表达变化，不增加 `partial`/`mode`/`raw` 类配置。
- 公共行为用测试锁定：新语义先补公共入口的用例，再扩展实现。
- 行为、类型推导、文档是同一次变更的完整交付物，同步更新。
- 文档一段一个主题：多主题并列的内容拆成条目列表，不把并列信息挤进长段落。

## 操作事实

- `vp run ready` 顺序为 构建 → 检查 → 测试：产物测试消费 `dist`，顺序是依赖不是风格。
- `packages/utils` 与 `apps/website` 是工具链示例，不投入产品化改进。
- 提交遵循 Conventional Commits：type/scope 用英文，subject 跟随仓库语言。

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Running Scripts

Run TypeScript and JavaScript files with `vpx <file>`, for example `vpx ./scripts/seed.ts --dry-run`. It handles enums, decorators, JSX, and tsconfig `paths`, so do not add `tsx` or `ts-node` to run scripts. `vpx --watch <file>` reruns the file when a file it uses changes, in place of `tsx watch`. `vp node <file>` runs plain Node.js.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->
