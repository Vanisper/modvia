import { defineModel, snakeCase, string, type InferData, type InferDTO } from "modvia";
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { z } from "zod";
import * as zMini from "zod/mini";
import { zodCodec } from "../src/index.ts";

describe("@modvia/zod — zodCodec", () => {
  test("将对称 Zod 标量与对象规则桥接为双向 Codec，保留嵌套路径与 zod.* 错误码", () => {
    const Email = zodCodec(z.email());
    expect(Email.decode("user@example.com")).toBe("user@example.com");
    expect(Email.encode("user@example.com")).toBe("user@example.com");
    expect(Email.safeDecode("not-an-email")).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "zod.invalid_format" }],
    });

    const Contact = defineModel({
      naming: snakeCase,
      fields: {
        primaryEmail: Email,
        backupEmails: zodCodec(z.array(z.email()).min(1)).optional(),
      },
    });

    const valid = Contact.decode({
      primary_email: "a@example.com",
      backup_emails: ["b@example.com"],
    });
    expect(valid).toStrictEqual({
      primaryEmail: "a@example.com",
      backupEmails: ["b@example.com"],
    });
    expect(Contact.encode(valid)).toStrictEqual({
      primary_email: "a@example.com",
      backup_emails: ["b@example.com"],
    });

    const failure = Contact.safeDecode({
      primary_email: "bad",
      backup_emails: ["ok@example.com", "wrong"],
    });
    expect(failure).toMatchObject({
      ok: false,
      issues: [
        { path: ["primary_email"], code: "zod.invalid_format" },
        { path: ["backup_emails", 1], code: "zod.invalid_format" },
      ],
    });

    const encodeFailure = Contact.safeEncode({
      primaryEmail: "bad",
      backupEmails: ["ok@example.com", "wrong"],
    });
    expect(encodeFailure).toMatchObject({
      ok: false,
      issues: [
        { path: ["primaryEmail"], code: "zod.invalid_format" },
        { path: ["backupEmails", 1], code: "zod.invalid_format" },
      ],
    });
  });

  test("原生支持 Zod v4 双向 z.codec 并与 Modvia 模型属性修饰无缝组合", () => {
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
        enabled: zodCodec(z.stringbool()).default(false),
      },
    });

    type EntryData = InferData<typeof LedgerEntry>;
    type EntryDTO = InferDTO<typeof LedgerEntry>;

    expectTypeOf<EntryData>().toEqualTypeOf<{
      readonly entryId: string;
      readonly amountFen: bigint;
      readonly enabled: boolean;
    }>();
    expectTypeOf<EntryDTO>().toMatchTypeOf<{
      entry_id: string;
      amount_fen?: string;
      enabled?: string;
    }>();

    const decoded = LedgerEntry.decode({
      entry_id: "e-1",
      amount_fen: "9007199254740993",
      enabled: "YES",
    });
    expect(decoded).toStrictEqual({
      entryId: "e-1",
      amountFen: 9007199254740993n,
      enabled: true,
    });
    // z.stringbool() 满足规范形态收敛律：解码接受 "YES"，编码归一收敛为 "true"
    expect(LedgerEntry.encode(decoded)).toStrictEqual({
      entry_id: "e-1",
      amount_fen: "9007199254740993",
      enabled: "true",
    });

    expect(LedgerEntry.decode({ entry_id: "e-2" })).toStrictEqual({
      entryId: "e-2",
      amountFen: 0n,
      enabled: false,
    });
  });

  test("兼容轻量级 zod/mini 构造的校验规则与双向 codec", () => {
    const MiniUuid = zodCodec(zMini.uuid());
    const sample = "550e8400-e29b-41d4-a716-446655440000";
    expect(MiniUuid.decode(sample)).toBe(sample);
    expect(MiniUuid.safeDecode("bad-uuid")).toMatchObject({
      ok: false,
      issues: [{ code: "zod.invalid_format" }],
    });
  });

  test("定义期拒绝破坏双向可逆性的单向 transform、隐式 coerce、吞错 catch 与异步规则", () => {
    const oneWay = z.string().transform((s) => s.length);
    // @ts-expect-error 单向 transform 在编译期与定义期均被拦截
    expect(() => zodCodec(oneWay)).toThrow(TypeError);

    const coerced = z.coerce.number();
    // @ts-expect-error 隐式有损 z.coerce 在编译期与定义期均被拦截
    expect(() => zodCodec(coerced)).toThrow(TypeError);

    const swallowed = z.string().catch("fallback");
    // @ts-expect-error 吞错 catch 在编译期与定义期均被拦截
    expect(() => zodCodec(swallowed)).toThrow(TypeError);

    // 嵌套在对象与联合内部的单向 transform 同样在定义期被拦截
    const nestedOneWay = z.object({
      count: z.string().transform((s) => Number(s)),
    });
    // @ts-expect-error 对象内部嵌套不可逆规则同样在编译期被拦截
    expect(() => zodCodec(nestedOneWay)).toThrow(TypeError);

    const unionOneWay = z.union([z.string(), z.number().transform((n) => String(n))]);
    expect(() => zodCodec(unionOneWay as never)).toThrow(TypeError);

    // 异步 refine 在执行期明确报 TypeError 拒绝
    const asyncRefined = zodCodec(z.string().refine(async (val) => val.length > 0, "async check"));
    expect(() => asyncRefined.safeDecode("hi")).toThrow(TypeError);
  });
});
