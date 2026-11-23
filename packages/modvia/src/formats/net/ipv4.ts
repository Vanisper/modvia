import { defineCodec } from "../../codec/core/define.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";

export function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

function validateIpv4(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!isValidIpv4(input)) {
    return context.fail("format.ipv4", "Expected a valid IPv4 address");
  }
  return input;
}

const defaultIpv4Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv4,
  encode: validateIpv4,
  meta: {
    format: "ipv4",
    encodedSchema: { type: "string", format: "ipv4" },
  },
});

/** IPv4 点分十进制地址双向编解码器（拒绝前导零） */
export function ipv4(): Codec<string, string> {
  return defaultIpv4Codec;
}
