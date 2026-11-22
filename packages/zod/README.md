# @modvia/zod

Modvia 官方 Zod v4 双向生态桥接包，将对称 Zod Schema 与双向 `z.codec` 转换为标准 Modvia `Codec`。

`modvia` 核心包保持零运行时依赖，本包通过 `peerDependencies` 对接 `zod@^4.0.0`（同时兼容 `"zod"` 与轻量 `"zod/mini"`）。

## 安装

```sh
pnpm add modvia @modvia/zod zod
```

## 快速上手

### 桥接对称校验规则与模型字段修饰

`zodCodec(schema)` 返回标准 `Codec<Output, Input>`，可直接接入 `defineModel`、`.from()`、`.optional()`、`.default()`、`.brand()` 等全部 Modvia 原语：

```ts
import { zodCodec } from "@modvia/zod";
import { defineModel, snakeCase } from "modvia";
import { z } from "zod";

const Contact = defineModel({
  naming: snakeCase,
  fields: {
    primaryEmail: zodCodec(z.email()),
    backupEmails: zodCodec(z.array(z.email()).min(1)).optional(),
  },
});

const contact = Contact.decode({
  primary_email: "ops@example.com",
  backup_emails: ["team@example.com"],
});
// { primaryEmail: "ops@example.com", backupEmails: ["team@example.com"] }

const dto = Contact.encode(contact);
// { primary_email: "ops@example.com", backup_emails: ["team@example.com"] }
```

### 桥接 Zod v4 双向 `z.codec`

当需要在同一规则内使用 Zod v4 的跨类型双向编解码器（如 `z.codec`、`z.stringbool`）时，`zodCodec` 自动连通正向 `safeParse` 与反向 `safeEncode`，完整推导 `Codec<Output, Input>` 类型：

```ts
import { zodCodec } from "@modvia/zod";
import { defineModel, snakeCase, string } from "modvia";
import { z } from "zod";

const BigIntFromString = zodCodec(
  z.codec(z.string().regex(/^-?\d+$/), z.bigint(), {
    decode: (raw) => BigInt(raw),
    encode: (val) => val.toString(),
  }),
);

const LedgerEntry = defineModel({
  naming: snakeCase,
  fields: {
    entryId: string(),
    amountFen: BigIntFromString.default(() => 0n),
  },
});
```

### 兼容 `zod/mini`

底层直接对接 `"zod/v4/core"` 协议，无需引入完整版 Zod 类包装即可使用 `"zod/mini"`：

```ts
import { zodCodec } from "@modvia/zod";
import * as zMini from "zod/mini";

const UuidCodec = zodCodec(zMini.uuid());
```

## 双向收敛守卫与错误协议

遵循 Modvia 的「双向收敛与操作三分」原则，`zodCodec` 在编译期与定义期双重拒绝破坏可逆性或吞没错误的规则：

- **单向转换（`.transform()` / `z.preprocess()` / `z.success()`）**：无法反向编码，在编译期置为 `never` 并在定义期抛出 `TypeError`；请改用双向 `z.codec(...)` 或 Modvia `defineCodec` + `pipe`。
- **隐式有损强转（`z.coerce.*`）**：接收 `unknown` 强转会破坏静态边界与往返收敛，在编译期与定义期同步拦截；布尔字符串等场景请使用显式收敛的 `z.stringbool()`。
- **吞错回退（`.catch()`）**：静默掩盖校验失败，违反显式错误收集契约，在编译期与定义期抛出 `TypeError`。
- **异步规则（`z.promise()` / 异步 `refine`）**：Modvia 编解码器保持纯同步执行，定义期或执行期遇到异步节点立即抛出 `TypeError`。
- **错误码与路径映射**：Zod 校验产生的每条 `$ZodIssue` 均保留完整子路径，并将错误码映射为 `zod.<issue.code>`（如 `zod.invalid_type`、`zod.invalid_format`、`zod.too_small`、`zod.custom`），与父级 `Model` 的外部 DTO 键名路径自动拼接。
