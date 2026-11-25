import { defineCodec } from "../codec/core/define.ts";
import type { Codec } from "../codec/core/types.ts";

const defaultUnknownCodec: Codec<unknown, unknown> = defineCodec<unknown, unknown>({
  decode: (input) => input,
  encode: (input) => input,
  descriptor: { kind: "unknown" },
});

/** 零开销原样透传编解码器，用于在模型或字典中显式声明任意动态载荷字段 */
export function unknown(): Codec<unknown, unknown> {
  return defaultUnknownCodec;
}
