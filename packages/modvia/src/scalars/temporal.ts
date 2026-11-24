const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const MAX_EPOCH_MS = 8_640_000_000_000_000;

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoTimePattern = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const lastDay = month === 2 && isLeapYear(year) ? 29 : (monthLengths[month - 1] ?? 0);
  return day <= lastDay;
}

export function isValidClockTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

export type IsoDateCheckResult = "ok" | "invalid_syntax" | "invalid_calendar";

export function checkIsoDateString(input: string): IsoDateCheckResult {
  const match = isoDatePattern.exec(input);
  if (!match) return "invalid_syntax";
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  return isValidCalendarDate(year, month, day) ? "ok" : "invalid_calendar";
}

export type IsoTimeCheckResult = "ok" | "invalid_syntax" | "invalid_clock";

export function checkIsoTimeString(input: string): IsoTimeCheckResult {
  const match = isoTimePattern.exec(input);
  if (!match) return "invalid_syntax";
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const second = Number(match[3]);
  return isValidClockTime(hour, minute, second) ? "ok" : "invalid_clock";
}

function readTwoDigits(input: string, offset: number): number {
  const d1 = input.charCodeAt(offset) - 48;
  const d2 = input.charCodeAt(offset + 1) - 48;
  if ((d1 | d2) < 0 || d1 > 9 || d2 > 9) return -1;
  return d1 * 10 + d2;
}

function readFourDigits(input: string, offset: number): number {
  const d1 = input.charCodeAt(offset) - 48;
  const d2 = input.charCodeAt(offset + 1) - 48;
  const d3 = input.charCodeAt(offset + 2) - 48;
  const d4 = input.charCodeAt(offset + 3) - 48;
  if ((d1 | d2 | d3 | d4) < 0 || d1 > 9 || d2 > 9 || d3 > 9 || d4 > 9) return -1;
  return d1 * 1000 + d2 * 100 + d3 * 10 + d4;
}

function readSixDigits(input: string, offset: number): number {
  const hi = readFourDigits(input, offset);
  const lo = readTwoDigits(input, offset + 4);
  if (hi < 0 || lo < 0) return -1;
  return hi * 100 + lo;
}

/**
 * 解析 ISO 日期时间文本并返回 UTC 毫秒时间戳：
 * - 合法且在原生 Date 范围内：返回精确整数毫秒值（`-0` 归一为 `0`）
 * - 语法、日历、时钟或时区偏移非法：返回 `Number.NaN`
 * - 语法与日历合法但超出原生 Date 范围（`±8.64e15`）：返回 `Number.POSITIVE_INFINITY`
 */
export function parseIsoDateTimeEpochMs(input: string): number {
  const len = input.length;
  if (len < 20) return Number.NaN;

  let year: number;
  let pos: number;
  const first = input.charCodeAt(0);
  if (first === 43 || first === 45) {
    if (len < 23) return Number.NaN;
    const absYear = readSixDigits(input, 1);
    if (absYear < 0 || (first === 45 && absYear === 0)) return Number.NaN;
    year = first === 45 ? -absYear : absYear;
    pos = 7;
  } else {
    year = readFourDigits(input, 0);
    if (year < 0) return Number.NaN;
    pos = 4;
  }

  if (
    pos + 15 >= len ||
    input.charCodeAt(pos) !== 45 ||
    input.charCodeAt(pos + 3) !== 45 ||
    input.charCodeAt(pos + 6) !== 84 ||
    input.charCodeAt(pos + 9) !== 58 ||
    input.charCodeAt(pos + 12) !== 58
  ) {
    return Number.NaN;
  }

  const month = readTwoDigits(input, pos + 1);
  const day = readTwoDigits(input, pos + 4);
  const hour = readTwoDigits(input, pos + 7);
  const minute = readTwoDigits(input, pos + 10);
  const second = readTwoDigits(input, pos + 13);
  if ((month | day | hour | minute | second) < 0) return Number.NaN;

  pos += 15;

  let ms = 0;
  if (input.charCodeAt(pos) === 46) {
    pos++;
    if (pos >= len) return Number.NaN;
    const d1 = input.charCodeAt(pos) - 48;
    if (d1 < 0 || d1 > 9) return Number.NaN;
    pos++;
    const d2 = pos < len ? input.charCodeAt(pos) - 48 : -1;
    if (d2 >= 0 && d2 <= 9) {
      pos++;
      const d3 = pos < len ? input.charCodeAt(pos) - 48 : -1;
      if (d3 >= 0 && d3 <= 9) {
        pos++;
        ms = d1 * 100 + d2 * 10 + d3;
        while (pos < len) {
          const extra = input.charCodeAt(pos) - 48;
          if (extra < 0 || extra > 9) break;
          pos++;
        }
      } else {
        ms = d1 * 100 + d2 * 10;
      }
    } else {
      ms = d1 * 100;
    }
  }

  if (pos >= len) return Number.NaN;
  let offsetMs = 0;
  const zoneChar = input.charCodeAt(pos);
  if (zoneChar === 90) {
    if (pos + 1 !== len) return Number.NaN;
  } else if (zoneChar === 43 || zoneChar === 45) {
    if (pos + 6 !== len || input.charCodeAt(pos + 3) !== 58) return Number.NaN;
    const zh = readTwoDigits(input, pos + 1);
    const zm = readTwoDigits(input, pos + 4);
    if (zh < 0 || zh > 23 || zm < 0 || zm > 59) return Number.NaN;
    offsetMs = (zh * 60 + zm) * 60_000;
    if (zoneChar === 45) offsetMs = -offsetMs;
  } else {
    return Number.NaN;
  }

  if (!isValidCalendarDate(year, month, day) || !isValidClockTime(hour, minute, second)) {
    return Number.NaN;
  }

  if (year < -271822 || year > 275761) {
    return Number.POSITIVE_INFINITY;
  }

  const adjustedYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(adjustedYear / 400);
  const yearOfEra = adjustedYear - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  const epochDays = era * 146097 + dayOfEra - 719468;

  const epochMs =
    epochDays * 86_400_000 + hour * 3_600_000 + minute * 60_000 + second * 1_000 + ms - offsetMs;

  if (epochMs < -MAX_EPOCH_MS || epochMs > MAX_EPOCH_MS) {
    return Number.POSITIVE_INFINITY;
  }

  return epochMs === 0 ? 0 : epochMs;
}

export function formatDateToUtcIso(input: unknown): string | null {
  if (typeof input !== "object" || input === null) return null;
  try {
    return Number.isNaN(Date.prototype.getTime.call(input))
      ? null
      : Date.prototype.toISOString.call(input);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}
