import { defineCodec } from "../../codec/core/define.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { isValidIpv6 } from "../../scalars/ip.ts";

function validateIpv6(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!isValidIpv6(input)) {
    return context.fail("format.ipv6", "Expected a valid IPv6 address");
  }
  return input;
}

const ipv6Schema = Object.freeze({ type: "string", format: "ipv6" });

const defaultIpv6Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv6,
  encode: validateIpv6,
  meta: {
    format: "ipv6",
    encodedSchema: ipv6Schema,
    decodedSchema: ipv6Schema,
  },
});

/** IPv6（RFC 4291）地址双向编解码器，支持零压缩与内嵌 IPv4 尾部 */
export function ipv6(): Codec<string, string> {
  return defaultIpv6Codec;
}
