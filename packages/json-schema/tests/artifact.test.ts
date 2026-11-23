import { toJsonSchema, withJsonSchema } from "@modvia/json-schema";
import { defineModel, int, snakeCase, string } from "modvia";
import { email } from "modvia/formats";
import { describe, expect, test } from "vite-plus/test";

describe("@modvia/json-schema packaged artifact", () => {
  test("通过包出口消费 @modvia/json-schema、modvia 与 modvia/formats 完成 Schema 导出", () => {
    const CreateMember = withJsonSchema(
      defineModel({
        alias: snakeCase,
        fields: {
          memberEmail: email({ trim: true }),
          displayName: string({ minLength: 1, maxLength: 32 }),
          seatLimit: int({ min: 1 }).default(5),
        },
      }),
    );

    expect(toJsonSchema(CreateMember, { target: "openapi-3.0" })).toStrictEqual({
      type: "object",
      properties: {
        member_email: { type: "string", format: "email", maxLength: 254 },
        display_name: { type: "string", minLength: 1, maxLength: 32 },
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
