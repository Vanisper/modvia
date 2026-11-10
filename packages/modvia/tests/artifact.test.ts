import { describe, expect, test } from "vite-plus/test";
import { arrayOf, defineModel, isModelValidationError, isoDateTime, oneOf, string } from "modvia";
import type { InferData, InferDTO } from "modvia";

// 通过包名自引用消费打包产物（exports → dist/index.mjs），
// 因此本文件必须在工作区构建之后运行（ready 已按 构建 → 检查 → 测试 排序）。

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

function captureError(run: () => unknown): unknown {
  try {
    run();
    return undefined;
  } catch (error) {
    return error;
  }
}

describe("packaged artifact", () => {
  test("decodes and encodes a full round-trip from dist", () => {
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
  });

  test("aggregates validation errors from the packaged build", () => {
    const error = captureError(() =>
      MemberModel.decode({
        id: "m-2",
        name: " ",
        role: "owner",
        joined_at: "2026-02-30T00:00:00Z",
        department: [],
      }),
    );
    if (!isModelValidationError(error)) throw new Error("Expected a model validation error");
    expect(error.issues.map((issue) => issue.code)).toEqual([
      "string.min_length",
      "one_of",
      "datetime.invalid",
      "type.object",
    ]);
  });
});
