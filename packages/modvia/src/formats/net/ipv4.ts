import { defineCodec } from "../../codec/core/define.ts";
import { builtinIssues, failIssue } from "../../codec/core/issues.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { isValidIpv4 } from "../../scalars/ip.ts";

function validateIpv4(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return failIssue(context, builtinIssues.typeString());
  }
  if (!isValidIpv4(input)) {
    return failIssue(context, builtinIssues.formatIpv4());
  }
  return input;
}

const defaultIpv4Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv4,
  encode: validateIpv4,
  descriptor: { kind: "string", format: "ipv4" },
});

/** IPv4 点分十进制地址双向编解码器（拒绝前导零） */
export function ipv4(): Codec<string, string> {
  return defaultIpv4Codec;
}
