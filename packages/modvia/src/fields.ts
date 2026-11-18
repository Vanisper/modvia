import { defineCodec, field } from "./core/codec.ts";
import type { CodecContext, Field } from "./core/types.ts";

export interface StringOptions {
  readonly trim?: boolean;
  readonly minLength?: number;
}

export function string(options: StringOptions = {}): Field<string, string> {
  const minLength = options.minLength ?? 0;
  if (!Number.isInteger(minLength) || minLength < 0) {
    throw new RangeError("minLength must be a non-negative integer");
  }
  const convert = (input: unknown, context: CodecContext): string => {
    if (typeof input !== "string") return context.fail("type.string", "Expected a string");
    const value = options.trim ? input.trim() : input;
    if (value.length < minLength) {
      return context.fail("string.min_length", `Expected at least ${minLength} characters`);
    }
    return value;
  };
  return field(defineCodec<string, string>({ decode: convert, encode: convert }));
}

export function number(): Field<number, number> {
  return field(
    defineCodec<number, number>({
      decode: finiteNumber,
      encode: finiteNumber,
    }),
  );
}

export function boolean(): Field<boolean, boolean> {
  const convert = (input: unknown, context: CodecContext): boolean => {
    if (typeof input !== "boolean") return context.fail("type.boolean", "Expected a boolean");
    return input;
  };
  return field(defineCodec<boolean, boolean>({ decode: convert, encode: convert }));
}

export function oneOf<const Values extends readonly string[]>(
  ...allowedValues: Values
): Field<Values[number], Values[number]> {
  if (allowedValues.length === 0) throw new RangeError("oneOf requires at least one value");
  const values = new Set<string>(allowedValues);
  const isAllowed = (value: string): value is Values[number] => values.has(value);
  const convert = (input: unknown, context: CodecContext): Values[number] => {
    if (typeof input !== "string" || !isAllowed(input)) {
      return context.fail("one_of", `Expected one of: ${[...values].join(", ")}`);
    }
    return input;
  };
  return field(defineCodec<Values[number], Values[number]>({ decode: convert, encode: convert }));
}

/**
 * 将带时区偏移的日期时间字符串与毫秒精度的 Date 互转
 *
 * @description 解码接受 `Z` 或 `-23:59` 至 `+23:59` 的数字偏移，编码统一输出 UTC，支持原生 Date 的完整年份范围
 */
export function isoDateTime(): Field<Date, string> {
  return field(
    defineCodec<Date, string>({
      decode: decodeIsoDateTime,
      encode(input, context) {
        try {
          return Date.prototype.toISOString.call(input);
        } catch (error) {
          if (error instanceof TypeError || error instanceof RangeError) {
            return context.fail("type.datetime", "Expected a valid Date");
          }
          throw error;
        }
      },
    }),
  );
}

function finiteNumber(input: unknown, context: CodecContext): number {
  if (typeof input !== "number" || !Number.isFinite(input)) {
    return context.fail("type.number", "Expected a finite number");
  }
  return input;
}

const isoDateTimePattern =
  /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?(Z|[+-]\d{2}:\d{2})$/;
const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

function decodeIsoDateTime(input: unknown, context: CodecContext): Date {
  if (typeof input !== "string") return context.fail("type.datetime", "Expected an ISO date-time");
  const parts = isoDateTimePattern.exec(input);
  if (!parts) return context.fail("datetime.invalid", "Invalid ISO date-time");

  const [, year, month, day, hour, minute, second, fraction = "", zone] = parts;
  if (
    year === "-000000" ||
    !isCalendarDate(Number(year), Number(month), Number(day)) ||
    Number(hour) > 23 ||
    Number(minute) > 59 ||
    Number(second) > 59 ||
    !isValidOffset(zone)
  ) {
    return context.fail("datetime.invalid", "Invalid ISO date-time");
  }

  // 日历日期按输入校验，Date 的范围由换算偏移后的时间点决定
  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0")}${zone}`,
  );
  if (Number.isNaN(date.getTime())) {
    return context.fail("datetime.out_of_range", "Date-time exceeds the native Date range");
  }
  return date;
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
