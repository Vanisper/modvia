import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  boolean,
  Codec,
  Field,
  isoDateTime,
  Model,
  number,
  oneOf,
  string,
  ValidationError,
} from "../../src/index.ts";
import type { CodecLike, InferData, InferDTO, InferModel } from "../../src/index.ts";

const DepartmentModel = Model.define({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
  },
});

type DepartmentData = InferData<typeof DepartmentModel>;

const UserModel = Model.define({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
    role: oneOf("admin", "manager", "member"),
    createdAt: isoDateTime().alias("created_at"),
    department: DepartmentModel,
    active: boolean(),
    score: number(),
  },
});

type UserData = InferData<typeof UserModel>;
type UserDTO = InferDTO<typeof UserModel>;
type ExpectedUserDTO = {
  id: string;
  name: string;
  role: "admin" | "manager" | "member";
  created_at: string;
  department: { id: string; name: string };
  active: boolean;
  score: number;
};

class User {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly role: "admin" | "manager" | "member";
  declare readonly createdAt: Date;
  declare readonly department: DepartmentData;
  declare readonly active: boolean;
  declare readonly score: number;

  constructor(data: UserData) {
    Object.assign(this, data);
  }

  get displayName(): string {
    return `${this.name} · ${this.department.name}`;
  }

  canManage(): boolean {
    return this.role === "admin" || this.role === "manager";
  }
}

const UserClassModel = UserModel.withFactory((data) => new User(data));

const validDTO = {
  id: "u-1",
  name: "  林舟  ",
  role: "manager",
  created_at: "2026-11-09T02:00:00+02:00",
  department: {
    id: "d-1",
    name: "  研发部  ",
    ignored: "nested",
  },
  active: true,
  score: 42,
  ignored: "root",
};

describe("domain model", () => {
  test("parse/dump 处理未知外界输入并剥离多余字段，decode/encode 校验强类型契约往返", () => {
    const user = UserModel.parse(validDTO);

    expect(user).toEqual({
      id: "u-1",
      name: "林舟",
      role: "manager",
      createdAt: new Date("2026-11-09T00:00:00.000Z"),
      department: { id: "d-1", name: "研发部" },
      active: true,
      score: 42,
    });
    expect(user).not.toBe(validDTO);
    expect(user.department).not.toBe(validDTO.department);
    expect(user).not.toHaveProperty("ignored");
    expect(user.department).not.toHaveProperty("ignored");

    const encoded = UserModel.encode(user);
    expect(encoded).toEqual({
      id: "u-1",
      name: "林舟",
      role: "manager",
      created_at: "2026-11-09T00:00:00.000Z",
      department: { id: "d-1", name: "研发部" },
      active: true,
      score: 42,
    });
    expect(UserModel.decode(encoded)).toEqual(user);
    expect(UserModel.dump({ ...user, extraDraftField: true })).toEqual(encoded);
    expect(encoded.department).not.toBe(user.department);
    expect(validDTO.name).toBe("  林舟  ");
  });

  test("嵌套模型无需 Field.of 包装即可直接调用 alias、optional 与 nullable", () => {
    const Team = Model.define({
      fields: {
        lead: UserClassModel.alias("team_lead").optional(),
        parentDept: DepartmentModel.nullable().alias("parent_dept"),
      },
    });

    const empty = Team.decode({ parent_dept: null });
    expect(empty).toStrictEqual({ parentDept: null });
    expect(Team.encode(empty)).toStrictEqual({ parent_dept: null });

    const populated = Team.parse({
      team_lead: validDTO,
      parent_dept: { id: "d-0", name: "技术中心" },
    });
    expect(populated.lead).toBeInstanceOf(User);
    // dump 允许将纯数据草稿按 UserClassModel 字段协议直接写出为 DTO
    expect(
      Team.dump({
        lead: UserModel.parse(validDTO),
        parentDept: { id: "d-0", name: "技术中心" },
      }),
    ).toMatchObject({
      team_lead: { id: "u-1", created_at: "2026-11-09T00:00:00.000Z" },
      parent_dept: { id: "d-0", name: "技术中心" },
    });
    expect(Team.encode(populated)).toMatchObject({
      team_lead: { id: "u-1", created_at: "2026-11-09T00:00:00.000Z" },
      parent_dept: { id: "d-0", name: "技术中心" },
    });
  });

  test("组合数组模型并精确定位嵌套错误路径", () => {
    const Users = arrayOf(UserModel);
    expect(Users.parse([validDTO])).toHaveLength(1);
    expect(Users.encode(Users.parse([validDTO]))).toHaveLength(1);

    const result = Users.safeParse([
      validDTO,
      {
        ...validDTO,
        name: " ",
        created_at: "2026-02-30T00:00:00Z",
        department: { id: "d-2", name: 42 },
      },
    ]);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected validation failure");
    expect(result.issues.map((issue) => ({ path: issue.path, code: issue.code }))).toEqual([
      { path: [1, "name"], code: "string.min_length" },
      { path: [1, "created_at"], code: "datetime.invalid" },
      { path: [1, "department", "name"], code: "type.string" },
    ]);
  });

  test("拒绝缺失必填键与非数组列表输入", () => {
    // @ts-expect-error decode 在编译期拦截缺失必填字段的残缺 DTO
    const compileChecked = UserModel.safeDecode({ id: "u-1" });
    expect(compileChecked.ok).toBe(false);

    const missing = UserModel.safeParse({ id: "u-1" });
    expect(missing.ok).toBe(false);
    if (missing.ok) throw new Error("Expected failure");
    expect(missing.issues.length).toBeGreaterThan(1);
    expect(missing.issues[0]).toMatchObject({ path: ["name"], code: "field.required" });

    expect(arrayOf(UserModel).safeParse({ 0: validDTO })).toMatchObject({
      ok: false,
      issues: [{ path: [], code: "type.array" }],
    });
  });

  test("定义期拒绝重复的外部键名", () => {
    const duplicateAliases = () =>
      Model.define({
        fields: {
          firstName: string().alias("name"),
          lastName: string().alias("name"),
        },
      });
    expect(duplicateAliases).toThrow(RangeError);
    expect(duplicateAliases).toThrow(/Duplicate field source "name"/);

    const aliasKeyCollision = () =>
      Model.define({
        fields: {
          nickname: string().alias("name"),
          name: string(),
        },
      });
    expect(aliasKeyCollision).toThrow(RangeError);
  });

  test("__proto__ 作为声明字段或外部别名时可安全双向读写自有键", () => {
    const Info = Model.define({ fields: { label: string() } });
    const Direct = Model.define({ fields: { ["__proto__"]: Info } });
    const Aliased = Model.define({ fields: { info: Info.alias("__proto__") } });
    const dto: unknown = JSON.parse('{"__proto__":{"label":"目录"}}');

    const data = Direct.parse(dto);
    const aliasedData = Aliased.parse(dto);
    expect(aliasedData).toStrictEqual({ info: { label: "目录" } });
    for (const output of [data, Direct.encode(data), Aliased.encode(aliasedData)]) {
      expect(Object.getPrototypeOf(output)).toBe(Object.prototype);
      expect(Object.hasOwn(output, "__proto__")).toBe(true);
      expect(output["__proto__"]).toStrictEqual({ label: "目录" });
    }
  });

  test("__proto__ 未声明时剥离，声明时遵守必填与缺省规则", () => {
    const Required = Model.define({ fields: { ["__proto__"]: string() } });
    const Optional = Model.define({ fields: { ["__proto__"]: string().optional() } });
    const Known = Model.define({ fields: { title: string() } });
    const input = { title: "目录", ["__proto__"]: "其他" };

    for (const output of [
      Known.parse(input),
      Known.dump(input),
      Optional.decode({}),
      Optional.encode({}),
    ]) {
      expect(Object.hasOwn(output, "__proto__")).toBe(false);
    }

    const missing = expect.objectContaining({
      issues: [expect.objectContaining({ path: ["__proto__"], code: "field.required" })],
    });
    expect(() => Required.parse({})).toThrow(missing);
    expect(() => Required.dump({})).toThrow(missing);
    // @ts-expect-error 编码输入缺少已声明的必填键
    expect(() => Required.encode({})).toThrow(missing);
  });

  test("解码仅接受普通对象输入", () => {
    class Payload {
      id = "p-1";
    }
    const cases: unknown[] = [null, [], new Date(), new Map([["id", "m-1"]]), new Payload()];
    for (const input of cases) {
      expect(UserModel.safeParse(input)).toStrictEqual({
        ok: false,
        issues: [{ path: [], code: "type.object", message: "Expected a plain object" }],
      });
    }

    expect(UserModel.parse(Object.assign(Object.create(null), validDTO))).toMatchObject({
      id: "u-1",
    });
  });

  test("聚合 20 万条错误时不触发调用栈溢出且保持单次异常构造", () => {
    const Tags = Model.define({
      fields: { items: arrayOf(string()) },
    });

    let caught: unknown;
    try {
      Tags.parse({ items: Array(200_000).fill(null) });
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(ValidationError);
    if (!ValidationError.is(caught)) throw new Error("Expected ValidationError");
    expect(caught.issues).toHaveLength(200_000);
  });

  test("withFactory 仅在整棵模型树校验通过后执行，重复调用时替换旧工厂", () => {
    let constructed = 0;
    const ClassUsers = UserModel.withFactory((data) => {
      constructed += 1;
      return new User(data);
    });

    const user = ClassUsers.parse(validDTO);
    expect(constructed).toBe(1);
    expect(user).toBeInstanceOf(User);
    expect(user.displayName).toBe("林舟 · 研发部");
    expect(user.canManage()).toBe(true);
    expect(ClassUsers.encode(user)).toEqual(UserModel.encode(UserModel.parse(validDTO)));
    expect(ClassUsers["~standard"].validate(validDTO)).toStrictEqual({ value: user });
    expect(constructed).toBe(2);

    expect(() => ClassUsers.parse({ ...validDTO, name: " " })).toThrow(ValidationError);
    expect(constructed).toBe(2);
    expect(UserModel.parse(validDTO)).not.toBeInstanceOf(User);

    const Replaced = ClassUsers.withFactory((data) => ({ ...data, tag: "plain" as const }));
    expect(Replaced.parse(validDTO).tag).toBe("plain");
    expect(constructed).toBe(2);
  });

  test("支持自定义 Codec 直接绑定字段别名，并忽略裸对象上未标记的 source 属性", () => {
    const slug = Codec.define<string, string>({
      decode(input, context) {
        if (typeof input !== "string" || !/^[a-z0-9-]+$/.test(input)) {
          return context.fail("string.slug", "Expected a lowercase slug");
        }
        return input;
      },
      encode(input, context) {
        if (typeof input !== "string" || !/^[a-z0-9-]+$/.test(input)) {
          return context.fail("string.slug", "Expected a lowercase slug");
        }
        return input;
      },
    });
    const sourceLikeCodec: CodecLike<string, string> & { readonly source: string } = {
      source: "not_an_alias",
      decode: (input) => (typeof input === "string" ? input : String(input)),
      encode: (value) => (typeof value === "string" ? value : String(value)),
    };

    const Article = Model.define({
      fields: {
        slug: slug.alias("article_slug"),
        name: sourceLikeCodec,
        alias: Field.of(string().alias("external_name")),
      },
    });

    const article = Article.decode({
      article_slug: "model-layer",
      name: "林舟",
      external_name: "林舟",
    });
    expect(article).toEqual({ slug: "model-layer", name: "林舟", alias: "林舟" });
    expect(Article.encode(article)).toEqual({
      article_slug: "model-layer",
      name: "林舟",
      external_name: "林舟",
    });

    expect(
      Article.safeDecode({ article_slug: "Not A Slug", name: "林舟", external_name: "林舟" }),
    ).toMatchObject({
      ok: false,
      issues: [{ path: ["article_slug"], code: "string.slug" }],
    });
    // encode 端同样对 unknown 输入严格守卫类型，不会把数字 123 当合法字符串放行
    expect(Article.safeDump({ slug: 123, name: "林舟", alias: "林舟" })).toMatchObject({
      ok: false,
      issues: [{ path: ["slug"], code: "string.slug" }],
    });
  });

  test("静态推导 Data、DTO 与工厂输出类型", () => {
    expectTypeOf<UserData>().toEqualTypeOf<{
      readonly id: string;
      readonly name: string;
      readonly role: "admin" | "manager" | "member";
      readonly createdAt: Date;
      readonly department: DepartmentData;
      readonly active: boolean;
      readonly score: number;
    }>();
    expectTypeOf<UserDTO>().toMatchTypeOf<ExpectedUserDTO>();
    expectTypeOf<ExpectedUserDTO>().toMatchTypeOf<UserDTO>();
    expectTypeOf<InferModel<typeof UserModel>>().toEqualTypeOf<UserData>();
    expectTypeOf<InferModel<typeof UserClassModel>>().toEqualTypeOf<User>();
    expectTypeOf<InferDTO<typeof UserClassModel>>().toEqualTypeOf<UserDTO>();
  });

  test("模型只收集字段表的可枚举字符串键", () => {
    const metadata = Symbol("metadata");
    const item = Model.define({
      fields: {
        1: number(),
        label: string(),
        get [metadata](): CodecLike<string, string> {
          throw new Error("符号键不参与模型定义");
        },
      },
    });
    const data = item.decode({ 1: 3, label: "目录" });
    expectTypeOf<keyof typeof data>().toEqualTypeOf<1 | "label">();
    expectTypeOf<keyof InferDTO<typeof item>>().toEqualTypeOf<1 | "label">();
    expect(item.encode(data)).toStrictEqual({ 1: 3, label: "目录" });
  });

  test("动态字段别名只写出实际选择的键", () => {
    function user(key: `user_${string}`) {
      return Model.define({ fields: { name: string().alias(key), id: number() } });
    }
    const dto = user("user_amy").encode({ name: "Amy", id: 1 });
    expect(dto).toStrictEqual({ id: 1, user_amy: "Amy" });
    expectTypeOf(dto.user_bob).toEqualTypeOf<string | undefined>();
    expectTypeOf(dto.id).toEqualTypeOf<number>();
  });

  test("联合字段表保留各分支的键以及索引签名中的已知字段", () => {
    const compact = { kind: oneOf("compact"), label: string().alias("title") };
    const counted = { kind: oneOf("counted"), count: number().optional() };
    function catalog(fields: typeof compact | typeof counted) {
      return Model.define({ fields });
    }
    const model = catalog(compact);
    const data = model.decode({ kind: "compact", title: "目录" });
    if (data.kind === "compact") expectTypeOf(data.label).toEqualTypeOf<string>();
    else expectTypeOf(data.count).toEqualTypeOf<number | undefined>();
    expect(model.encode(data)).toStrictEqual({ kind: "compact", title: "目录" });
    type DTO = InferDTO<typeof model>;
    expectTypeOf<Extract<DTO, { kind: "compact" }>["title"]>().toEqualTypeOf<string>();

    const fields: Record<string, CodecLike<unknown, unknown>> & typeof compact = compact;
    const indexed = Model.define({ fields });
    expectTypeOf<InferData<typeof indexed>["label"]>().toEqualTypeOf<string>();
    expectTypeOf<InferDTO<typeof indexed>["title"]>().toEqualTypeOf<string>();
  });
});
