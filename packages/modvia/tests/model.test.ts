import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  boolean,
  defineCodec,
  defineModel,
  field,
  isModelValidationError,
  isoDateTime,
  ModelValidationError,
  number,
  oneOf,
  string,
} from "../src/index.ts";
import type { Codec, InferData, InferDTO, InferModel } from "../src/index.ts";

const DepartmentModel = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
  },
});

type DepartmentData = InferData<typeof DepartmentModel>;

const UserModel = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
    role: oneOf("admin", "manager", "member"),
    createdAt: isoDateTime().from("created_at"),
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

function captureError(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("model codec", () => {
  test("decodes plain data and encodes the same contract back to DTO", () => {
    const user = UserModel.decode(validDTO);

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
    expect(encoded.department).not.toBe(user.department);
    expect(validDTO.name).toBe("  林舟  ");
  });

  test("composes arrays and reports nested input paths", () => {
    const Users = arrayOf(UserModel);
    expect(Users.decode([validDTO])).toHaveLength(1);
    expect(Users.encode(Users.decode([validDTO]))).toHaveLength(1);

    const error = captureError(() =>
      Users.decode([
        validDTO,
        {
          ...validDTO,
          name: " ",
          created_at: "2026-02-30T00:00:00Z",
          department: { id: "d-2", name: 42 },
        },
      ]),
    );

    expect(error).toBeInstanceOf(ModelValidationError);
    if (!isModelValidationError(error)) throw new Error("Expected a model validation error");
    expect(error.issues.map((issue) => ({ path: issue.path, code: issue.code }))).toEqual([
      { path: [1, "name"], code: "string.min_length" },
      { path: [1, "created_at"], code: "datetime.invalid" },
      { path: [1, "department", "name"], code: "type.string" },
    ]);
  });

  test("rejects missing fields and non-array lists", () => {
    const missing = captureError(() => UserModel.decode({ id: "u-1" }));
    if (!isModelValidationError(missing)) throw new Error("Expected a model validation error");
    expect(missing.issues.length).toBeGreaterThan(1);
    expect(missing.issues[0]).toMatchObject({ path: ["name"], code: "field.required" });

    const list = captureError(() => arrayOf(UserModel).decode({ 0: validDTO }));
    expect(list).toBeInstanceOf(ModelValidationError);
    expect(list).toMatchObject({ issues: [{ path: [], code: "type.array" }] });
  });

  test("rejects duplicate field sources at definition time", () => {
    const duplicateAliases = () =>
      defineModel({
        fields: {
          firstName: string().from("name"),
          lastName: string().from("name"),
        },
      });
    expect(duplicateAliases).toThrow(RangeError);
    expect(duplicateAliases).toThrow(/Duplicate field source "name"/);

    const aliasKeyCollision = () =>
      defineModel({
        fields: {
          nickname: string().from("name"),
          name: string(),
        },
      });
    expect(aliasKeyCollision).toThrow(RangeError);
  });

  test("aggregates very large error sets without exhausting the call stack", () => {
    const Tags = defineModel({
      fields: { items: arrayOf(string()) },
    });

    const error = captureError(() => Tags.decode({ items: Array(200_000).fill(null) }));
    expect(error).toBeInstanceOf(ModelValidationError);
    if (!isModelValidationError(error)) throw new Error("Expected a model validation error");
    expect(error.issues).toHaveLength(200_000);
  });

  test("materializes a real class only after the full model is valid", () => {
    let constructed = 0;
    const ClassUsers = UserModel.withFactory((data) => {
      constructed += 1;
      return new User(data);
    });

    const user = ClassUsers.decode(validDTO);
    expect(constructed).toBe(1);
    expect(user).toBeInstanceOf(User);
    expect(user.displayName).toBe("林舟 · 研发部");
    expect(user.canManage()).toBe(true);
    expect(ClassUsers.encode(user)).toEqual(UserModel.encode(UserModel.decode(validDTO)));

    expect(() => ClassUsers.decode({ ...validDTO, name: " " })).toThrow(ModelValidationError);
    expect(constructed).toBe(1);
    expect(UserModel.decode(validDTO)).not.toBeInstanceOf(User);
  });

  test("supports custom codecs and field aliases", () => {
    const slug = defineCodec<string, string>({
      decode(input, context) {
        if (typeof input !== "string" || !/^[a-z0-9-]+$/.test(input)) {
          return context.fail("string.slug", "Expected a lowercase slug");
        }
        return input;
      },
      encode(input, context) {
        if (!/^[a-z0-9-]+$/.test(input)) {
          return context.fail("string.slug", "Expected a lowercase slug");
        }
        return input;
      },
    });
    const Article = defineModel({
      fields: { slug: field(slug).from("article_slug") },
    });

    const article = Article.decode({ article_slug: "model-layer" });
    expect(article).toEqual({ slug: "model-layer" });
    expect(Article.encode(article)).toEqual({ article_slug: "model-layer" });

    const error = captureError(() => Article.decode({ article_slug: "Not A Slug" }));
    expect(error).toMatchObject({
      issues: [{ path: ["article_slug"], code: "string.slug" }],
    });
  });

  test("ignores unbranded source properties and keeps aliases when re-wrapping fields", () => {
    const withExtraProperty = {
      source: "not_an_alias",
      decode(input: unknown): string {
        return typeof input === "string" ? input : String(input);
      },
      encode(value: string): string {
        return value;
      },
    };
    const sourceLikeCodec: Codec<string, string> = withExtraProperty;
    const Custom = defineModel({
      fields: {
        name: sourceLikeCodec,
        alias: field(string().from("external_name")),
      },
    });

    expect(Custom.decode({ name: "林舟", external_name: "林舟" })).toEqual({
      name: "林舟",
      alias: "林舟",
    });
    expect(Custom.encode({ name: "林舟", alias: "林舟" })).toEqual({
      name: "林舟",
      external_name: "林舟",
    });
    expectTypeOf<InferDTO<typeof Custom>>().toMatchTypeOf<{
      name: string;
      external_name: string;
    }>();
    expectTypeOf<{
      name: string;
      external_name: string;
    }>().toMatchTypeOf<InferDTO<typeof Custom>>();
  });

  test("infers data, DTO, and class output types", () => {
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
});
