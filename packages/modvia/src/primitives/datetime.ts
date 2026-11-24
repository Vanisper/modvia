import { createCodec } from "../codec/core/runtime.ts";
import type { Codec } from "../codec/core/types.ts";
import { formatDateToUtcIso, parseIsoDateTimeEpochMs } from "../scalars/temporal.ts";

const defaultIsoDateTimeCodec: Codec<Date, string> = createCodec<Date, string>(
  (input, direction, collector) => {
    if (direction === "decode") {
      if (typeof input !== "string") {
        return collector.add("type.datetime", "Expected an ISO date-time");
      }
      const epochMs = parseIsoDateTimeEpochMs(input);
      if (Number.isNaN(epochMs)) {
        return collector.add("datetime.invalid", "Invalid ISO date-time");
      }
      if (!Number.isFinite(epochMs)) {
        return collector.add("datetime.out_of_range", "Date-time exceeds the native Date range");
      }
      return new Date(epochMs);
    }

    const formatted = formatDateToUtcIso(input);
    if (formatted === null) {
      return collector.add("type.datetime", "Expected a valid Date");
    }
    return formatted;
  },
  { descriptor: { kind: "datetime" } },
);

/**
 * 将带时区偏移的 ISO 日期时间字符串与毫秒精度 Date 互转
 *
 * @description 解码接受 Z 或 -23:59 至 +23:59 的数字偏移，编码统一输出 UTC，支持原生 Date 全范围
 */
export function isoDateTime(): Codec<Date, string> {
  return defaultIsoDateTimeCodec;
}
