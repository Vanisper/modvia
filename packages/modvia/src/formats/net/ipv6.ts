import { defineCodec } from "../../codec/core/define.ts";
import { builtinIssues, failIssue } from "../../codec/core/issues.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { isValidIpv6 } from "../../scalars/ip.ts";

function validateIpv6(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return failIssue(context, builtinIssues.typeString());
  }
  if (!isValidIpv6(input)) {
    return failIssue(context, builtinIssues.formatIpv6());
  }
  return input;
}

const defaultIpv6Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv6,
  encode: validateIpv6,
  descriptor: { kind: "string", format: "ipv6" },
});

/** IPv6 十六进制冒号分隔地址双向编解码器（支持 `::` 压缩与内嵌 IPv4 尾部） */
export function ipv6(): Codec<string, string> {
  return defaultIpv6Codec;
}
