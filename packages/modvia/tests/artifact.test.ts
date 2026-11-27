import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import * as modviaEntry from "modvia";
import {
  Alias,
  arrayOf,
  bigint,
  boolean,
  Codec,
  Field,
  int,
  isoDateTime,
  literal,
  Model,
  number,
  string,
  ValidationError,
  type InferData,
  type InferDTO,
} from "modvia";
import * as codecEntry from "modvia/codec";
import * as formatsEntry from "modvia/formats";
import { email, jsonOf, uuid } from "modvia/formats";

// 通过包出口消费打包产物（modvia → dist/index.js，modvia/codec → dist/codec.js），
// 必须在工作区构建之后运行（vp run ready 已按 构建 → 检查 → 测试 排序）。

const Department = Model.define({
  fields: {
    id: string(),
    name: string().trim().nonEmpty(),
  },
});

const MemberModel = Model.define({
  fields: {
    id: string(),
    name: string().trim().nonEmpty(),
    role: literal("admin", "manager", "member"),
    joinedAt: isoDateTime().alias("joined_at"),
    department: Department,
  },
});

type MemberData = InferData<typeof MemberModel>;
type MemberDTO = InferDTO<typeof MemberModel>;

class Member {
  declare readonly id: string;
  declare readonly name: string;
  declare readonly role: "admin" | "manager" | "member";
  declare readonly joinedAt: Date;
  declare readonly department: MemberData["department"];

  constructor(data: MemberData) {
    Object.assign(this, data);
  }

  get title(): string {
    return `${this.name} · ${this.department.name}`;
  }
}

const MemberEntity = MemberModel.withFactory((data) => new Member(data));
const Members = arrayOf(MemberEntity);

const dtoList = [
  {
    id: "m-1",
    name: "  林舟  ",
    role: "manager",
    joined_at: "2026-11-09T02:00:00+02:00",
    department: { id: "d-1", name: "  研发部  ", extra: "ignored" },
    extra: "ignored",
  },
];

describe("packaged artifacts (modvia & modvia/codec)", () => {
  test("各包入口与主体命名空间精确暴露公开运行时导出集并共享同一原语引用", () => {
    expect(string).toBe(codecEntry.string);
    expect(arrayOf).toBe(codecEntry.arrayOf);
    expect(isoDateTime).toBe(codecEntry.isoDateTime);
    expect(Codec).toBe(codecEntry.Codec);
    expect(Field).toBe(codecEntry.Field);
    expect(ValidationError).toBe(codecEntry.ValidationError);

    expect(Object.keys(codecEntry).sort()).toStrictEqual([
      "Codec",
      "Field",
      "ValidationError",
      "arrayOf",
      "bigint",
      "boolean",
      "int",
      "isoDateTime",
      "literal",
      "number",
      "recordOf",
      "string",
      "tupleOf",
      "unknown",
    ]);
    expect(Object.keys(modviaEntry).sort()).toStrictEqual(
      [...Object.keys(codecEntry), "Alias", "Model"].sort(),
    );
    expect(Object.keys(formatsEntry).sort()).toStrictEqual([
      "email",
      "ipv4",
      "ipv6",
      "isoDate",
      "isoTime",
      "jsonOf",
      "jsonString",
      "url",
      "uuid",
    ]);

    expect(Object.keys(Codec).sort()).toStrictEqual([
      "define",
      "extendStandard",
      "inspect",
      "invert",
      "lazy",
      "pipe",
      "union",
    ]);
    expect(Object.keys(Field).sort()).toStrictEqual(["is", "of"]);
    expect(Object.keys(Model).sort()).toStrictEqual(["define", "union"]);
    expect(Object.keys(Alias).sort()).toStrictEqual(["define", "kebabCase", "snakeCase"]);

    const positiveMap = codecEntry.recordOf(
      codecEntry
        .int()
        .refine((n) => n > 0, "number.positive", "Expected > 0")
        .brand<"PositiveInt">(),
    );
    expect(positiveMap.decode({ a: 1 })).toStrictEqual({ a: 1 });
    expect(positiveMap.safeDecode({ a: 0 }).ok).toBe(false);
    expect(positiveMap.safeDecode({ a: 1.5 }).ok).toBe(false);

    const pair = codecEntry.tupleOf(
      codecEntry
        .string()
        .trim()
        .normalize((s) => s.toLowerCase()),
      codecEntry.unknown(),
    );
    expect(pair.decode(["  OK ", { raw: 1 }])).toStrictEqual(["ok", { raw: 1 }]);

    const nums = codecEntry.arrayOf(codecEntry.number().or("auto", null));
    expect(nums.safeDecode([1, "auto", null])).toStrictEqual({
      ok: true,
      value: [1, "auto", null],
    });

    const Cents = Codec.define({
      state: { min: 0 },
      decode(raw, ctx) {
        if (typeof raw !== "string" || !/^-?\d+$/.test(raw)) {
          return ctx.fail("money.invalid", "Invalid cents");
        }
        const n = Number(raw);
        if (n < ctx.state.min) return ctx.fail("money.min", "Below min");
        return n;
      },
      encode(val, ctx) {
        if (typeof val !== "number" || !Number.isSafeInteger(val) || val < ctx.state.min) {
          return ctx.fail("money.min", "Invalid cents");
        }
        return String(val);
      },
      methods: {
        min: (min: number) => ({ min }),
      },
    });
    expect(Cents.min(100).decode("250")).toBe(250);
    expect(Cents.min(100).safeDecode("50").ok).toBe(false);

    const AccountJson = jsonOf(
      Model.define({
        alias: Alias.snakeCase,
        fields: {
          accountId: uuid(),
          contactEmail: email().trim().lowercase(),
          port: int().min(1).max(65535).fromString(),
          ratio: number().nonNegative().max(1).fromString(),
          enabled: boolean().fromString(),
          quotaBytes: bigint().positive().fromString(),
        },
      })
        .describe("Account wire payload")
        .strict(),
    );
    const account = AccountJson.decode(
      '{"account_id":"550E8400-E29B-41D4-A716-446655440000","contact_email":" Ops@Example.com ","port":"8080","ratio":"0.5","enabled":"TRUE","quota_bytes":"9007199254740993"}',
    );
    expect(account).toStrictEqual({
      accountId: "550e8400-e29b-41d4-a716-446655440000",
      contactEmail: "ops@example.com",
      port: 8080,
      ratio: 0.5,
      enabled: true,
      quotaBytes: 9007199254740993n,
    });
    expect(JSON.parse(AccountJson.encode(account))).toStrictEqual({
      account_id: "550e8400-e29b-41d4-a716-446655440000",
      contact_email: "ops@example.com",
      port: "8080",
      ratio: "0.5",
      enabled: "true",
      quota_bytes: "9007199254740993",
    });
  });

  test("从包入口组合可选日期数组并编码工厂实例的公开字段", () => {
    const Schedule = Model.define({
      fields: { dates: arrayOf(isoDateTime().nullable()).optional().alias("event_dates") },
    });
    expectTypeOf<InferData<typeof Schedule>>().toEqualTypeOf<{
      readonly dates?: (Date | null)[];
    }>();
    expectTypeOf<InferDTO<typeof Schedule>>().toEqualTypeOf<{
      readonly event_dates?: (string | null)[];
    }>();

    class Calendar {
      #dates: (Date | null)[];
      constructor(data: InferData<typeof Schedule>) {
        this.#dates = data.dates ?? [];
      }
      get dates() {
        return this.#dates;
      }
    }

    const Calendars = Schedule.withFactory((data) => new Calendar(data));
    const dto = { event_dates: ["2026-11-09T00:00:00.000Z", "+010000-01-01T00:00:00.000Z", null] };
    expect(Calendars.encode(Calendars.decode(dto))).toStrictEqual(dto);
    expect(Schedule.encode(Schedule.decode({}))).toStrictEqual({});
    expect(Calendars.encode(Calendars.decode({}))).toStrictEqual({ event_dates: [] });

    const MemberSummary = MemberEntity.pick("id", "joinedAt");
    expect(
      MemberSummary.encode(
        MemberSummary.decode({ id: "m-1", joined_at: "2026-11-09T00:00:00.000Z" }),
      ),
    ).toStrictEqual({
      id: "m-1",
      joined_at: "2026-11-09T00:00:00.000Z",
    });

    const TextEvent = Model.define({ fields: { type: literal("text"), message: string() } });
    const SystemEvent = Model.define({
      fields: { type: literal("system"), code: codecEntry.number() },
    });
    const EventCodec = Model.union("type", [TextEvent, SystemEvent]);
    expect(EventCodec.encode(EventCodec.decode({ type: "system", code: 200 }))).toStrictEqual({
      type: "system",
      code: 200,
    });

    const Config = Model.define({
      alias: Alias.snakeCase,
      fields: {
        maxRetries: codecEntry.int().default(3),
        serviceUrl: string(),
      },
    });
    expect(Config.encode(Config.decode({ service_url: "https://api.example.com" }))).toStrictEqual({
      max_retries: 3,
      service_url: "https://api.example.com",
    });
    expect(Config.partial().decode({})).toStrictEqual({});
  });

  test("通过 dist 完成完整实例往返与 Standard Schema 校验", () => {
    const members = Members.parse(dtoList);
    expect(members).toHaveLength(1);

    const member = members[0];
    expect(member).toBeInstanceOf(Member);
    expect(member.title).toBe("林舟 · 研发部");
    expect({
      id: member.id,
      name: member.name,
      role: member.role,
      joinedAt: member.joinedAt,
      department: member.department,
    }).toEqual({
      id: "m-1",
      name: "林舟",
      role: "manager",
      joinedAt: new Date("2026-11-09T00:00:00.000Z"),
      department: { id: "d-1", name: "研发部" },
    } satisfies MemberData);

    const encoded: MemberDTO[] = Members.encode(members);
    expect(encoded).toEqual([
      {
        id: "m-1",
        name: "林舟",
        role: "manager",
        joined_at: "2026-11-09T00:00:00.000Z",
        department: { id: "d-1", name: "研发部" },
      },
    ]);
    expect(Members.decode(encoded)).toHaveLength(1);
    expect(Members.dump(members)).toEqual(encoded);

    expect(Members["~standard"].validate(dtoList)).toMatchObject({
      value: [expect.any(Member)],
    });
  });

  test("从打包产物聚合多字段校验错误", () => {
    let caught: unknown;
    try {
      MemberModel.parse({
        id: "m-2",
        name: " ",
        role: "owner",
        joined_at: "2026-02-30T00:00:00Z",
        department: [],
      });
    } catch (error) {
      caught = error;
    }

    if (!ValidationError.is(caught)) throw new Error("Expected ValidationError");
    expect(caught.issues.map((issue) => issue.code)).toEqual([
      "string.min_length",
      "literal.no_match",
      "format.iso_datetime",
      "type.object",
    ]);
  });
});
