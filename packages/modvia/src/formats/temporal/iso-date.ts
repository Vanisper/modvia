import { defineCodec } from "../../codec/core/define.ts";
import { builtinIssues, failIssue } from "../../codec/core/issues.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { checkIsoDateString } from "../../scalars/temporal.ts";

function validateIsoDate(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return failIssue(context, builtinIssues.typeString());
  }
  const status = checkIsoDateString(input);
  if (status === "invalid_syntax") {
    return failIssue(context, builtinIssues.formatIsoDate());
  }
  if (status === "invalid_calendar") {
    return failIssue(context, builtinIssues.formatIsoDate("Invalid calendar date"));
  }
  return input;
}

const defaultIsoDateCodec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIsoDate,
  encode: validateIsoDate,
  descriptor: { kind: "string", format: "date" },
});

/** 公历日期字符串（YYYY-MM-DD）双向编解码器，精确校验闰年与大小月天数 */
export function isoDate(): Codec<string, string> {
  return defaultIsoDateCodec;
}
