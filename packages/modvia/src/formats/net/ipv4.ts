import { defineCodec } from "../../codec/core/define.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { isValidIpv4 } from "../../scalars/ip.ts";

function validateIpv4(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!isValidIpv4(input)) {
    return context.fail("format.ipv4", "Expected a valid IPv4 address");
  }
  return input;
}

const ipv4Schema = Object.freeze({ type: "string", format: "ipv4" });

const defaultIpv4Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv4,
  encode: validateIpv4,
  descriptor: {
    kind: "custom",
    format: "ipv4",
    encodedSchema: ipv4Schema,
    decodedSchema: ipv4Schema,
  },
});

/** IPv4 点分十进制地址双向编解码器（拒绝前导零） */
export function ipv4(): Codec<string, string> {
  return defaultIpv4Codec;
}
