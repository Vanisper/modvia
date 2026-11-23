import { defineCodec } from "../codec/core/define.ts";
import type { Codec } from "../codec/core/types.ts";

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoTimePattern = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const monthDays = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** 公历日期字符串（YYYY-MM-DD）双向编解码器，精确校验闰年与大小月天数 */
export function isoDate(): Codec<string, string> {
  const run = (input: unknown, context: { fail(code: string, message: string): never }): string => {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    const match = isoDatePattern.exec(input);
    if (!match) {
      return context.fail("format.iso_date", "Expected an ISO date string (YYYY-MM-DD)");
    }
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (!isValidCalendarDate(year, month, day)) {
      return context.fail("format.iso_date", "Invalid calendar date");
    }
    return input;
  };

  return defineCodec<string, string>({
    decode: run,
    encode: run,
    meta: {
      format: "date",
      encodedSchema: { type: "string", format: "date" },
    },
  });
}

/** 时间字符串（HH:mm:ss[.sss]）双向编解码器 */
export function isoTime(): Codec<string, string> {
  const run = (input: unknown, context: { fail(code: string, message: string): never }): string => {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    const match = isoTimePattern.exec(input);
    if (!match) {
      return context.fail("format.iso_time", "Expected an ISO time string (HH:mm:ss)");
    }
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    const second = Number(match[3]);
    if (hour > 23 || minute > 59 || second > 59) {
      return context.fail("format.iso_time", "Invalid clock time");
    }
    return input;
  };

  return defineCodec<string, string>({
    decode: run,
    encode: run,
    meta: {
      format: "time",
      encodedSchema: { type: "string", format: "time" },
    },
  });
}

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  if (month === 2 && isLeapYear(year)) return day <= 29;
  const maxDay = monthDays[month - 1];
  return maxDay !== undefined && day <= maxDay;
}

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
