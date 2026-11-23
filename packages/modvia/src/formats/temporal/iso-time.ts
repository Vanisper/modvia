import { defineCodec } from "../../codec/core/define.ts";
import type { Codec, CodecContext } from "../../codec/core/types.ts";
import { checkIsoTimeString } from "../../scalars/temporal.ts";

function validateIsoTime(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  const status = checkIsoTimeString(input);
  if (status === "invalid_syntax") {
    return context.fail("format.iso_time", "Expected an ISO time string (HH:mm:ss)");
  }
  if (status === "invalid_clock") {
    return context.fail("format.iso_time", "Invalid clock time");
  }
  return input;
}

const isoTimeSchema = Object.freeze({ type: "string", format: "time" });

const defaultIsoTimeCodec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIsoTime,
  encode: validateIsoTime,
  meta: {
    format: "time",
    encodedSchema: isoTimeSchema,
    decodedSchema: isoTimeSchema,
  },
});

/** 时间字符串（HH:mm:ss[.sss]）双向编解码器 */
export function isoTime(): Codec<string, string> {
  return defaultIsoTimeCodec;
}
