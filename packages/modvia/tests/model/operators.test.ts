import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  defineModel,
  defineNaming,
  isoDateTime,
  kebabCase,
  literal,
  number,
  oneOf,
  snakeCase,
  string,
  taggedUnion,
  type InferData,
  type InferDTO,
  type InferEncoded,
  type InferModel,
  type InferValue,
} from "../../src/index.ts";

const BaseUser = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
    role: oneOf("admin", "member"),
    createdAt: isoDateTime().from("created_at"),
    bio: string().optional(),
  },
});

class UserAccount {
  readonly #id: string;
  declare readonly name: string;
  declare readonly role: "admin" | "member";
  declare readonly createdAt: Date;
  declare readonly bio?: string;

  constructor({ id, ...rest }: InferData<typeof BaseUser>) {
    this.#id = id;
    Object.assign(this, rest);
  }

  get id(): string {
    return this.#id;
  }
}

const UserAccountModel = BaseUser.withFactory((data) => new UserAccount(data));

describe("model introspection & derivation", () => {
  test("公开冻结的 fields 描述符表且不泄漏符号属性", () => {
    expect(Object.isFrozen(BaseUser.fields)).toBe(true);
    expect(Object.keys(BaseUser.fields)).toEqual(["id", "name", "role", "createdAt", "bio"]);
    expect(BaseUser.fields.createdAt.source).toBe("created_at");
    expect(UserAccountModel.fields).toBe(BaseUser.fields);
  });

  test("pick 与 omit 保留字段别名与可选性，并将工厂模型重置回纯数据输出", () => {
    const Summary = UserAccountModel.pick("id", "createdAt", "bio");
    const CreatePayload = BaseUser.omit("id", "createdAt");

    const stamp = "2026-11-09T00:00:00.000Z";
    const summary = Summary.decode({ id: "u-1", created_at: stamp });
    expect(summary).not.toBeInstanceOf(UserAccount);
    expect(summary).toStrictEqual({ id: "u-1", createdAt: new Date(stamp) });
    expect(Summary.encode(summary)).toStrictEqual({ id: "u-1", created_at: stamp });

    const createData = CreatePayload.decode({ name: "  林舟  ", role: "admin" });
    expect(createData).toStrictEqual({ name: "林舟", role: "admin" });
    expect(CreatePayload.encode(createData)).toStrictEqual({ name: "林舟", role: "admin" });

    expectTypeOf<InferModel<typeof Summary>>().toEqualTypeOf<{
      readonly id: string;
      readonly createdAt: Date;
      readonly bio?: string;
    }>();
    expectTypeOf<InferDTO<typeof Summary>>().toMatchTypeOf<{
      id: string;
      created_at: string;
      bio?: string;
    }>();
    expectTypeOf<InferData<typeof CreatePayload>>().toEqualTypeOf<{
      readonly name: string;
      readonly role: "admin" | "member";
      readonly bio?: string;
    }>();

    // @ts-expect-error 不存在的字段名在编译期与定义期均被拒绝
    expect(() => BaseUser.pick("unknown")).toThrow(RangeError);
    // @ts-expect-error 不存在的字段名在编译期与定义期均被拒绝
    expect(() => BaseUser.omit("unknown")).toThrow(RangeError);
  });

  test("extend 支持扩展与覆写字段，并在定义期拦截外部别名冲突", () => {
    const SuperAdmin = BaseUser.extend({
      role: literal("superadmin"),
      permissions: arrayOf(string()).from("perm_list"),
    });

    const decoded = SuperAdmin.decode({
      id: "u-9",
      name: "林舟",
      role: "superadmin",
      created_at: "2026-11-09T00:00:00Z",
      perm_list: ["users:write"],
    });
    expect(decoded.role).toBe("superadmin");
    expect(decoded.permissions).toStrictEqual(["users:write"]);
    expect(SuperAdmin.encode(decoded)).toMatchObject({
      role: "superadmin",
      perm_list: ["users:write"],
    });

    expectTypeOf<InferData<typeof SuperAdmin>["role"]>().toEqualTypeOf<"superadmin">();
    expectTypeOf<InferDTO<typeof SuperAdmin>["perm_list"]>().toEqualTypeOf<string[]>();

    // 新字段与已有字段的外部键名碰撞时立即抛 RangeError
    expect(() =>
      BaseUser.extend({
        registeredAt: isoDateTime().from("created_at"),
      }),
    ).toThrow(RangeError);
  });

  test("partial 支持全量与指定字段可选化，保留外部别名并移除创建期默认值避免覆盖", () => {
    const WithDefault = BaseUser.extend({
      status: oneOf("active", "archived").default("active").from("account_status"),
    });

    const FullPatch = WithDefault.partial();
    expect(FullPatch.decode({})).toStrictEqual({});
    expect(FullPatch.decode({ created_at: "2026-11-09T00:00:00.000Z" })).toStrictEqual({
      createdAt: new Date("2026-11-09T00:00:00.000Z"),
    });
    expect(FullPatch.encode({ status: "archived" })).toStrictEqual({ account_status: "archived" });

    expectTypeOf<InferData<typeof FullPatch>>().toEqualTypeOf<{
      readonly id?: string;
      readonly name?: string;
      readonly role?: "admin" | "member";
      readonly createdAt?: Date;
      readonly bio?: string;
      readonly status?: "active" | "archived";
    }>();

    const SelectivePatch = BaseUser.partial("name", "createdAt");
    expect(SelectivePatch.decode({ id: "u-1", role: "member" })).toStrictEqual({
      id: "u-1",
      role: "member",
    });
    expectTypeOf<InferData<typeof SelectivePatch>>().toEqualTypeOf<{
      readonly id: string;
      readonly name?: string;
      readonly role: "admin" | "member";
      readonly createdAt?: Date;
      readonly bio?: string;
    }>();

    // @ts-expect-error 不存在的字段名在编译期与定义期均被拒绝
    expect(() => BaseUser.partial("missing")).toThrow(RangeError);
  });

  test("naming 策略自动同步编译期与运行时外部键映射，显式 .from() 优先", () => {
    const Profile = defineModel({
      naming: snakeCase,
      fields: {
        userId: string(),
        isEmailVerified: literal(true, false).default(false),
        htmlURL: string().optional(),
        legacyCode: string().from("USR_CODE"),
      },
    });

    const decoded = Profile.decode({
      user_id: "u-1",
      html_url: "https://example.com",
      USR_CODE: "L-9",
    });
    expect(decoded).toStrictEqual({
      userId: "u-1",
      isEmailVerified: false,
      htmlURL: "https://example.com",
      legacyCode: "L-9",
    });
    expect(Profile.encode(decoded)).toStrictEqual({
      user_id: "u-1",
      is_email_verified: false,
      html_url: "https://example.com",
      USR_CODE: "L-9",
    });

    expectTypeOf<InferDTO<typeof Profile>>().toMatchTypeOf<{
      user_id: string;
      is_email_verified?: boolean;
      html_url?: string;
      USR_CODE: string;
    }>();

    // 派生子模型完整保留命名策略生成的外部键名
    const Picked = Profile.pick("userId", "legacyCode");
    expect(Picked.encode({ userId: "u-1", legacyCode: "L-9" })).toStrictEqual({
      user_id: "u-1",
      USR_CODE: "L-9",
    });

    const HeaderModel = defineModel({
      naming: kebabCase,
      fields: { traceId: string(), clientVersion: string() },
    });
    expect(HeaderModel.encode({ traceId: "t-1", clientVersion: "1.0" })).toStrictEqual({
      "trace-id": "t-1",
      "client-version": "1.0",
    });
    expectTypeOf<InferDTO<typeof HeaderModel>>().toMatchTypeOf<{
      "trace-id": string;
      "client-version": string;
    }>();

    const UpperNaming = defineNaming((key) => key.toUpperCase());
    const EnvModel = defineModel({
      naming: UpperNaming,
      fields: { appPort: number() },
    });
    expect(EnvModel.decode({ APPPORT: 8080 })).toStrictEqual({ appPort: 8080 });

    // 命名转换后若与已有字段名碰撞则在定义期抛 RangeError
    expect(() =>
      defineModel({
        naming: snakeCase,
        fields: { userId: string(), user_id: string() },
      }),
    ).toThrow(RangeError);
  });

  test("对模型调用 check 时自动将声明字段路径双向翻译为 DTO 外部键与模型内部键", () => {
    const PasswordReset = defineModel({
      naming: snakeCase,
      fields: {
        newPassword: string({ minLength: 6 }),
        confirmPassword: string({ minLength: 6 }),
      },
    }).check((data, context) => {
      if (data.newPassword !== data.confirmPassword) {
        context.issue({
          code: "password.mismatch",
          message: "Passwords do not match",
          path: ["confirmPassword"],
        });
      }
    });

    expect(
      PasswordReset.safeDecode({
        new_password: "secret-1",
        confirm_password: "secret-2",
      }),
    ).toStrictEqual({
      ok: false,
      issues: [
        {
          path: ["confirm_password"],
          code: "password.mismatch",
          message: "Passwords do not match",
        },
      ],
    });

    expect(
      PasswordReset.safeEncode({
        newPassword: "secret-1",
        confirmPassword: "secret-2",
      }),
    ).toStrictEqual({
      ok: false,
      issues: [
        {
          path: ["confirmPassword"],
          code: "password.mismatch",
          message: "Passwords do not match",
        },
      ],
    });
  });
});

describe("taggedUnion", () => {
  const TextBlock = defineModel({
    fields: {
      kind: oneOf("text").from("block_type"),
      body: string({ trim: true, minLength: 1 }),
    },
  });

  class ImageBlockEntity {
    readonly #url: string;
    constructor(data: { readonly kind: "image"; readonly url: string }) {
      this.#url = data.url;
    }
    get kind(): "image" {
      return "image";
    }
    get url(): string {
      return this.#url;
    }
  }

  const ImageBlock = defineModel({
    fields: {
      kind: literal("image").from("block_type"),
      url: string({ minLength: 1 }).from("image_url"),
    },
  }).withFactory((data) => new ImageBlockEntity(data));

  const ContentBlock = taggedUnion("kind", [TextBlock, ImageBlock]);

  test("按标签 O(1) 双向分发普通模型与工厂实例，并支持判别键外部别名", () => {
    const Blocks = arrayOf(ContentBlock);
    const decoded = Blocks.decode([
      { block_type: "text", body: "  正文段落  " },
      { block_type: "image", image_url: "https://example.com/a.png" },
    ]);

    expect(decoded[0]).toStrictEqual({ kind: "text", body: "正文段落" });
    expect(decoded[1]).toBeInstanceOf(ImageBlockEntity);

    expect(Blocks.encode(decoded)).toStrictEqual([
      { block_type: "text", body: "正文段落" },
      { block_type: "image", image_url: "https://example.com/a.png" },
    ]);

    expectTypeOf<InferValue<typeof ContentBlock>>().toEqualTypeOf<
      InferModel<typeof TextBlock> | ImageBlockEntity
    >();
    expectTypeOf<InferEncoded<typeof ContentBlock>>().toEqualTypeOf<
      InferDTO<typeof TextBlock> | InferDTO<typeof ImageBlock>
    >();
  });

  test("精确定位缺失标签、非法标签及命中分支内部字段的错误路径", () => {
    expect(ContentBlock.safeDecode({})).toMatchObject({
      ok: false,
      issues: [{ path: ["block_type"], code: "field.required" }],
    });

    expect(ContentBlock.safeDecode({ block_type: "video" })).toMatchObject({
      ok: false,
      issues: [{ path: ["block_type"], code: "union.invalid_tag" }],
    });

    expect(ContentBlock.safeDecode({ block_type: "image", image_url: "" })).toMatchObject({
      ok: false,
      issues: [{ path: ["image_url"], code: "string.min_length" }],
    });

    expect(Reflect.apply(ContentBlock.safeEncode, undefined, [{}])).toMatchObject({
      ok: false,
      issues: [{ path: ["kind"], code: "field.required" }],
    });

    expect(Reflect.apply(ContentBlock.safeEncode, undefined, [{ kind: "video" }])).toMatchObject({
      ok: false,
      issues: [{ path: ["kind"], code: "union.invalid_tag" }],
    });
  });

  test("定义期拒绝重复标签、可选判别键、不一致外部名或非常量判别规则", () => {
    const DuplicateText = defineModel({
      fields: { kind: literal("text").from("block_type"), note: number() },
    });
    expect(() => taggedUnion("kind", [TextBlock, DuplicateText])).toThrow(RangeError);

    const InconsistentSource = defineModel({
      fields: { kind: literal("quote"), quote: string() },
    });
    expect(() => taggedUnion("kind", [TextBlock, InconsistentSource])).toThrow(RangeError);

    const OptionalTag = defineModel({
      fields: { kind: literal("quote").from("block_type").optional() },
    });
    // @ts-expect-error 可选判别键在编译期与定义期均被拒绝
    expect(() => taggedUnion("kind", [TextBlock, OptionalTag])).toThrow(RangeError);

    const MissingTag = defineModel({
      fields: { title: string() },
    });
    // @ts-expect-error 缺少判别键的模型在编译期与定义期均被拒绝
    expect(() => taggedUnion("kind", [TextBlock, MissingTag])).toThrow(RangeError);

    const DynamicTag = defineModel({
      fields: { kind: string().from("block_type") },
    });
    expect(() => taggedUnion("kind", [TextBlock, DynamicTag])).toThrow(TypeError);
  });
});
