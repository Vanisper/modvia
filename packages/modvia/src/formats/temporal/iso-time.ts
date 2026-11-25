import { defineCodec } from "../../codec/core/define.ts";
import { builtinIssues, failIssue } from "../../codec/core/issues.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { checkIsoTimeString } from "../../scalars/temporal.ts";

function validateIsoTime(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return failIssue(context, builtinIssues.typeString());
  }
  const status = checkIsoTimeString(input);
  if (status === "invalid_syntax") {
    return failIssue(context, builtinIssues.formatIsoTime());
  }
  if (status === "invalid_clock") {
    return failIssue(context, builtinIssues.formatIsoTime("Invalid clock time"));
  }
  return input;
}

const defaultIsoTimeCodec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIsoTime,
  encode: validateIsoTime,
  descriptor: { kind: "string", format: "time" },
});

/** 时间字符串（HH:mm:ss[.sss]）双向编解码器 */
export function isoTime(): Codec<string, string> {
  return defaultIsoTimeCodec;
}
