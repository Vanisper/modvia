import * as zodEntry from "@modvia/zod";
import { zodCodec } from "@modvia/zod";
import { Alias, Model, string } from "modvia";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";

describe("@modvia/zod packaged artifact", () => {
  test("通过包出口组合 @modvia/zod 与 modvia 完成双向往返", () => {
    expect(Object.keys(zodEntry).sort()).toStrictEqual(["zodCodec"]);
    const IsoToTimestamp = zodCodec(
      z.codec(z.iso.datetime(), z.int(), {
        decode: (iso) => new Date(iso).getTime(),
        encode: (ms) => new Date(ms).toISOString(),
      }),
    );

    const AuditLog = Model.define({
      alias: Alias.snakeCase,
      fields: {
        actorEmail: zodCodec(z.email()),
        occurredAtMs: IsoToTimestamp.alias("occurred_at"),
        note: string().optional(),
      },
    });

    const decoded = AuditLog.parse({
      actor_email: "ops@example.com",
      occurred_at: "2026-11-09T00:00:00.000Z",
    });
    expect(decoded).toStrictEqual({
      actorEmail: "ops@example.com",
      occurredAtMs: 1794182400000,
    });
    expect(AuditLog.dump(decoded)).toStrictEqual({
      actor_email: "ops@example.com",
      occurred_at: "2026-11-09T00:00:00.000Z",
    });
  });
});
