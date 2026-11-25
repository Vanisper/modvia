import { defineCodec } from "../codec/core/define.ts";
import type { Codec } from "../codec/core/types.ts";
import { formatDateToUtcIso, parseIsoDateTimeEpochMs } from "../scalars/temporal.ts";

const defaultIsoDateTimeCodec: Codec<Date, string> = defineCodec<Date, string>({
  decode(input, context) {
    if (typeof input !== "string") {
      return context.fail("type.datetime", "Expected an ISO date-time");
    }
    const epochMs = parseIsoDateTimeEpochMs(input);
    if (Number.isNaN(epochMs)) {
      return context.fail("datetime.invalid", "Invalid ISO date-time");
    }
    if (!Number.isFinite(epochMs)) {
      return context.fail("datetime.out_of_range", "Date-time exceeds the native Date range");
    }
    return new Date(epochMs);
  },
  encode(input, context) {
    return formatDateToUtcIso(input) ?? context.fail("type.datetime", "Expected a valid Date");
  },
  descriptor: { kind: "datetime" },
});

/**
 * 将带时区偏移的 ISO 日期时间字符串与毫秒精度 Date 互转
 *
 * @description 解码接受 Z 或 -23:59 至 +23:59 的数字偏移，编码统一输出 UTC，支持原生 Date 全范围
 */
export function isoDateTime(): Codec<Date, string> {
  return defaultIsoDateTimeCodec;
}
