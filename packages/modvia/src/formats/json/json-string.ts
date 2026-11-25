import { defineCodec } from "../../codec/core/define.ts";
import type { Codec } from "../../codec/core/types.ts";

const defaultJsonStringCodec: Codec<unknown, string> = defineCodec<unknown, string>({
  decode(input, context) {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a JSON string");
    }
    try {
      return JSON.parse(input) as unknown;
    } catch {
      return context.fail("format.json", "Invalid JSON text");
    }
  },
  encode(input, context) {
    try {
      const serialized = JSON.stringify(input);
      if (serialized === undefined) {
        return context.fail("format.json", "Value cannot be serialized to JSON");
      }
      return serialized;
    } catch {
      return context.fail("format.json", "Value cannot be serialized to JSON");
    }
  },
  descriptor: {
    kind: "custom",
    format: "json",
    encodedSchema: { type: "string" },
    decodedSchema: {},
  },
});

/** JSON 文本与任意可序列化值之间的双向编解码器（string ↔ unknown） */
export function jsonString(): Codec<unknown, string> {
  return defaultJsonStringCodec;
}
