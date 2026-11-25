import { defineCodec } from "../codec/core/define.ts";
import { builtinIssues, failIssue } from "../codec/core/issues.ts";
import type { Codec, CodecContext } from "../codec/core/types.ts";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateUuid(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return failIssue(context, builtinIssues.typeString());
  }
  if (!uuidPattern.test(input)) {
    return failIssue(context, builtinIssues.formatUuid());
  }
  return input.toLowerCase();
}

const defaultUuidCodec: Codec<string, string> = defineCodec<string, string>({
  decode: validateUuid,
  encode: validateUuid,
  descriptor: { kind: "string", format: "uuid" },
});

/**
 * 标准 UUID（RFC 9562 / 4122）双向编解码器
 *
 * @description 解码与编码两端均归一为全小写十六进制形态，满足往返收敛律
 */
export function uuid(): Codec<string, string> {
  return defaultUuidCodec;
}
