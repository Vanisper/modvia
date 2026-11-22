import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  arrayOf,
  defineModel,
  isValidationError,
  isoDateTime,
  oneOf,
  string,
  type InferData,
  type InferDTO,
} from "modvia";
import * as codecEntry from "modvia/codec";

// 通过包出口消费打包产物（modvia → dist/index.mjs，modvia/codec → dist/codec.mjs），
// 必须在工作区构建之后运行（vp run ready 已按 构建 → 检查 → 测试 排序）。

const Department = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
  },
});

const MemberModel = defineModel({
  fields: {
    id: string(),
    name: string({ trim: true, minLength: 1 }),
    role: oneOf("admin", "manager", "member"),
    joinedAt: isoDateTime().from("joined_at"),
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
  test("主入口与 ./codec 子路径共享同一套编解码原语引用", () => {
    expect(string).toBe(codecEntry.string);
    expect(arrayOf).toBe(codecEntry.arrayOf);
    expect(isoDateTime).toBe(codecEntry.isoDateTime);
    expect(isValidationError).toBe(codecEntry.isValidationError);
    expect("defineModel" in codecEntry).toBe(false);

    const positiveMap = codecEntry.recordOf(
      codecEntry.number().check((n, ctx) => {
        if (n <= 0) ctx.fail("number.positive", "Expected > 0");
      }),
    );
    expect(positiveMap.decode({ a: 1 })).toStrictEqual({ a: 1 });
    expect(positiveMap.safeDecode({ a: 0 }).ok).toBe(false);

    const nums = codecEntry.arrayOf(codecEntry.number().or("auto", null));
    expect(nums.safeDecode([1, "auto", null])).toStrictEqual({
      ok: true,
      value: [1, "auto", null],
    });
  });

  test("从包入口组合可选日期数组并编码工厂实例的公开字段", () => {
    const Schedule = defineModel({
      fields: { dates: arrayOf(isoDateTime().nullable()).optional().from("event_dates") },
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
  });

  test("通过 dist 完成完整实例往返与 Standard Schema 校验", () => {
    const members = Members.decode(dtoList);
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

    expect(Members["~standard"].validate(dtoList)).toMatchObject({
      value: [expect.any(Member)],
    });
  });

  test("从打包产物聚合多字段校验错误", () => {
    let caught: unknown;
    try {
      MemberModel.decode({
        id: "m-2",
        name: " ",
        role: "owner",
        joined_at: "2026-02-30T00:00:00Z",
        department: [],
      });
    } catch (error) {
      caught = error;
    }

    if (!isValidationError(caught)) throw new Error("Expected ValidationError");
    expect(caught.issues.map((issue) => issue.code)).toEqual([
      "string.min_length",
      "string.one_of",
      "datetime.invalid",
      "type.object",
    ]);
  });
});
