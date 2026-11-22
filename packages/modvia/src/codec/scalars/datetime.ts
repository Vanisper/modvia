import type { IssueCollector } from "../core/collector.ts";
import { createCodec } from "../core/runtime.ts";
import type { Codec } from "../core/types.ts";

/**
 * 将带时区偏移的 ISO 日期时间字符串与毫秒精度 Date 互转
 *
 * @description 解码接受 Z 或 -23:59 至 +23:59 的数字偏移，编码统一输出 UTC，支持原生 Date 全范围
 */
export function isoDateTime(): Codec<Date, string> {
  return createCodec<Date, string>(
    (input, direction, collector) =>
      direction === "decode"
        ? decodeIsoDateTime(input, collector)
        : encodeIsoDateTime(input, collector),
    { descriptor: { kind: "datetime" } },
  );
}

const isoDateTimePattern =
  /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?(Z|[+-]\d{2}:\d{2})$/;
const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function decodeIsoDateTime(input: unknown, collector: IssueCollector) {
  if (typeof input !== "string") {
    return collector.add("type.datetime", "Expected an ISO date-time");
  }
  const parts = isoDateTimePattern.exec(input);
  if (!parts) {
    return collector.add("datetime.invalid", "Invalid ISO date-time");
  }

  const [, year, month, day, hour, minute, second, fraction = "", zone] = parts;
  if (
    year === "-000000" ||
    !isCalendarDate(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    !isValidOffset(zone)
  ) {
    return collector.add("datetime.invalid", "Invalid ISO date-time");
  }

  // 日历日期按输入校验，Date 范围由换算偏移后的时间点决定
  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0")}${zone}`,
  );
  if (Number.isNaN(date.getTime())) {
    return collector.add("datetime.out_of_range", "Date-time exceeds the native Date range");
  }
  return date;
}

function encodeIsoDateTime(input: unknown, collector: IssueCollector) {
  try {
    return Date.prototype.toISOString.call(input);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return collector.add("type.datetime", "Expected a valid Date");
    }
    throw error;
  }
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const lastDay = month === 2 && leapYear ? 29 : (monthLengths[month - 1] ?? 0);
  return day >= 1 && day <= lastDay;
}

function isValidOffset(zone: string): boolean {
  if (zone === "Z") return true;
  const hours = Number(zone.slice(1, 3));
  const minutes = Number(zone.slice(4, 6));
  return hours <= 23 && minutes <= 59;
}
