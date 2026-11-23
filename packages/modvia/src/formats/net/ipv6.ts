import { defineCodec } from "../../codec/core/define.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { isValidIpv4 } from "./ipv4.ts";

const h16Pattern = /^[0-9a-fA-F]{1,4}$/;

export function isValidIpv6(value: string): boolean {
  if (value.length === 0 || value.includes("%")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;

  const leftRaw = halves[0] ?? "";
  const rightRaw = halves[1];

  const leftParts = leftRaw === "" ? [] : leftRaw.split(":");
  const rightParts = rightRaw === undefined || rightRaw === "" ? [] : rightRaw.split(":");
  if (leftRaw === "" && halves.length === 1) return false;

  let trailingIpv4Groups = 0;
  const tailContainer = rightParts.length > 0 ? rightParts : leftParts;
  const lastSegment = tailContainer[tailContainer.length - 1];
  if (lastSegment !== undefined && lastSegment.includes(".")) {
    if (!isValidIpv4(lastSegment)) return false;
    tailContainer.pop();
    trailingIpv4Groups = 2;
  }

  for (const seg of leftParts) {
    if (!h16Pattern.test(seg)) return false;
  }
  for (const seg of rightParts) {
    if (!h16Pattern.test(seg)) return false;
  }

  const totalGroups = leftParts.length + rightParts.length + trailingIpv4Groups;
  return halves.length === 2 ? totalGroups < 8 : totalGroups === 8;
}

function validateIpv6(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!isValidIpv6(input)) {
    return context.fail("format.ipv6", "Expected a valid IPv6 address");
  }
  return input;
}

const defaultIpv6Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv6,
  encode: validateIpv6,
  meta: {
    format: "ipv6",
    encodedSchema: { type: "string", format: "ipv6" },
  },
});

/** IPv6（RFC 4291）地址双向编解码器，支持零压缩与内嵌 IPv4 尾部 */
export function ipv6(): Codec<string, string> {
  return defaultIpv6Codec;
}
