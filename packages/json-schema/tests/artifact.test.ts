import { toJsonSchema, withJsonSchema } from "@modvia/json-schema";
import { Alias, int, Model, string } from "modvia";
import { email } from "modvia/formats";
import { describe, expect, test } from "vite-plus/test";

describe("@modvia/json-schema packaged artifact", () => {
  test("通过包出口消费 @modvia/json-schema、modvia 与 modvia/formats 完成 Schema 导出", () => {
    const CreateMember = withJsonSchema(
      Model.define({
        alias: Alias.snakeCase,
        fields: {
          memberEmail: email({ trim: true }),
          displayName: string({ minLength: 1, maxLength: 32 }).describe("Member display name"),
          seatLimit: int({ min: 1 }).default(5),
        },
      }).describe("Create member payload"),
    );

    expect(toJsonSchema(CreateMember, { target: "openapi-3.0" })).toStrictEqual({
      type: "object",
      description: "Create member payload",
      properties: {
        member_email: { type: "string", format: "email", maxLength: 254 },
        display_name: {
          type: "string",
          minLength: 1,
          maxLength: 32,
          description: "Member display name",
        },
        seat_limit: { type: "integer", minimum: 1 },
      },
      required: ["member_email", "display_name"],
      additionalProperties: false,
    });

    expect(CreateMember["~standard"].jsonSchema.output({ target: "draft-2020-12" })).toMatchObject({
      required: ["memberEmail", "displayName", "seatLimit"],
    });
  });
});
