import { defineCodec } from "../codec/core/define.ts";
import { assertValueCodec } from "../codec/core/runtime.ts";
import type { Codec, ValueCodecInput } from "../codec/core/types.ts";

/** JSON 文本与任意可序列化值之间的双向编解码器（string ↔ unknown） */
export function jsonString(): Codec<unknown, string> {
  return defineCodec<unknown, string>({
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
    meta: {
      format: "json",
      encodedSchema: { type: "string" },
      decodedSchema: {},
    },
  });
}

/** 将目标值级 Codec 或领域 Model 包装为「JSON 文本 ↔ 业务值 T」的一体化双向 Codec */
export function jsonOf<T, Encoded>(codec: ValueCodecInput<T, Encoded>): Codec<T, string> {
  assertValueCodec(codec, "jsonOf");
  return jsonString().pipe(codec);
}
