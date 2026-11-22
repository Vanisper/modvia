import { createCodec, isFieldLiteral } from "./kernel.ts";
import type { IssueCollector } from "./errors.ts";
import type { Codec, FieldLiteral } from "./types.ts";

export interface StringOptions {
  readonly trim?: boolean;
  readonly minLength?: number;
}

/** 字符串双向编解码器，可选去除首尾空白并校验最小 UTF-16 长度 */
export function string(options: StringOptions = {}): Codec<string, string> {
  const minLength = options.minLength ?? 0;
  if (!Number.isInteger(minLength) || minLength < 0) {
    throw new RangeError("minLength must be a non-negative integer");
  }
  const trim = Boolean(options.trim);

  return createCodec<string, string>((input, _direction, collector) => {
    if (typeof input !== "string") {
      return collector.add("type.string", "Expected a string");
    }
    const value = trim ? input.trim() : input;
    if (value.length < minLength) {
      return collector.add("string.min_length", `Expected at least ${minLength} characters`);
    }
    return value;
  });
}

/** 有限数字双向编解码器，拒绝 NaN 与正负无穷 */
export function number(): Codec<number, number> {
  return createCodec<number, number>((input, _direction, collector) => {
    if (typeof input !== "number" || !Number.isFinite(input)) {
      return collector.add("type.number", "Expected a finite number");
    }
    return input;
  });
}

/** 布尔值双向编解码器 */
export function boolean(): Codec<boolean, boolean> {
  return createCodec<boolean, boolean>((input, _direction, collector) => {
    if (typeof input !== "boolean") {
      return collector.add("type.boolean", "Expected a boolean");
    }
    return input;
  });
}

/** 字符串字面量枚举双向编解码器 */
export function oneOf<const Values extends readonly string[]>(
  ...allowedValues: Values
): Codec<Values[number], Values[number]> {
  if (allowedValues.length === 0) {
    throw new RangeError("oneOf requires at least one value");
  }
  const values = new Set<string>(allowedValues);
  const expectedMessage = `Expected one of: ${[...values].join(", ")}`;
  const isAllowed = (value: string): value is Values[number] => values.has(value);

  return createCodec<Values[number], Values[number]>(
    (input, _direction, collector) => {
      if (typeof input !== "string" || !isAllowed(input)) {
        return collector.add("string.one_of", expectedMessage);
      }
      return input;
    },
    { allowedLiterals: [...values] },
  );
}

/** 精确匹配一个或多个原始字面量（按 Object.is 比较） */
export function literal<const Values extends readonly [FieldLiteral, ...FieldLiteral[]]>(
  ...allowedValues: Values
): Codec<Values[number], Values[number]> {
  if (allowedValues.length === 0) {
    throw new RangeError("literal requires at least one value");
  }
  if (!allowedValues.every(isFieldLiteral)) {
    throw new TypeError("literal only accepts string, number, boolean, null, or undefined values");
  }

  const uniqueValues: FieldLiteral[] = [];
  for (const candidate of allowedValues) {
    if (!uniqueValues.some((existing) => Object.is(existing, candidate))) {
      uniqueValues.push(candidate);
    }
  }
  const expectedMessage = `Expected literal: ${uniqueValues.map(formatLiteral).join(", ")}`;

  return createCodec<Values[number], Values[number]>(
    (input, _direction, collector) => {
      for (const candidate of uniqueValues) {
        if (Object.is(input, candidate)) return candidate as Values[number];
      }
      return collector.add("value.literal", expectedMessage);
    },
    { allowedLiterals: uniqueValues },
  );
}

function formatLiteral(value: FieldLiteral): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Object.is(value, -0)) return "-0";
  return String(value);
}

/**
 * 将带时区偏移的 ISO 日期时间字符串与毫秒精度 Date 互转
 *
 * @description 解码接受 Z 或 -23:59 至 +23:59 的数字偏移，编码统一输出 UTC，支持原生 Date 全范围
 */
export function isoDateTime(): Codec<Date, string> {
  return createCodec<Date, string>((input, direction, collector) =>
    direction === "decode"
      ? decodeIsoDateTime(input, collector)
      : encodeIsoDateTime(input, collector),
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
