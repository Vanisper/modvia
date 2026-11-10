import assert from "node:assert/strict";
import {
  arrayOf,
  defineModel,
  isModelValidationError,
  isoDateTime,
  oneOf,
  string,
} from "../dist/index.mjs";
import type { InferData, InferDTO } from "../dist/index.mjs";

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

const members = Members.decode(dtoList);
assert.equal(members.length, 1);

const member = members[0];
assert.ok(member instanceof Member);
assert.equal(member.title, "林舟 · 研发部");
assert.deepEqual(
  {
    id: member.id,
    name: member.name,
    role: member.role,
    joinedAt: member.joinedAt,
    department: member.department,
  },
  {
    id: "m-1",
    name: "林舟",
    role: "manager",
    joinedAt: new Date("2026-11-09T00:00:00.000Z"),
    department: { id: "d-1", name: "研发部" },
  } satisfies MemberData,
);

const encoded: MemberDTO[] = Members.encode(members);
assert.deepEqual(encoded, [
  {
    id: "m-1",
    name: "林舟",
    role: "manager",
    joined_at: "2026-11-09T00:00:00.000Z",
    department: { id: "d-1", name: "研发部" },
  },
]);

assert.throws(
  () =>
    MemberModel.decode({
      id: "m-2",
      name: " ",
      role: "owner",
      joined_at: "2026-02-30T00:00:00Z",
      department: [],
    }),
  (error: unknown) => isModelValidationError(error) && error.issues.length > 0,
);

console.log("artifact smoke: dist round-trip ok");
