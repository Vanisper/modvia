import { defineCodec } from "../../codec/core/define.ts";
import { builtinIssues } from "../../codec/core/issues.ts";
import type { Codec } from "../../codec/core/types.ts";

const defaultJsonStringCodec: Codec<unknown, string> = defineCodec<unknown, string>({
  decode(input, context) {
    if (typeof input !== "string") {
      return context.issue(builtinIssues.typeString());
    }
    try {
      return JSON.parse(input) as unknown;
    } catch {
      return context.issue(builtinIssues.formatJson());
    }
  },
  encode(input, context) {
    try {
      const serialized = JSON.stringify(input);
      if (serialized === undefined) {
        return context.issue(builtinIssues.jsonUnserializable());
      }
      return serialized;
    } catch {
      return context.issue(builtinIssues.jsonUnserializable());
    }
  },
  descriptor: { kind: "json" },
});

/** JSON 文本与任意可序列化值之间的双向编解码器（string ↔ unknown） */
export function jsonString(): Codec<unknown, string> {
  return defaultJsonStringCodec;
}
