const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isoDatePattern = /^(\d{4})-(\d{2})-(\d{2})$/;
const isoTimePattern = /^(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/;
const isoDateTimePattern =
  /^(\d{4}|[+-]\d{6})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?(Z|[+-]\d{2}:\d{2})$/;

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

export function isValidUtcOffset(zone: string): boolean {
  if (zone === "Z") return true;
  const hours = Number(zone.slice(1, 3));
  const minutes = Number(zone.slice(4, 6));
  return hours <= 23 && minutes <= 59;
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

export type ParseIsoDateTimeResult =
  | { readonly ok: true; readonly date: Date }
  | { readonly ok: false; readonly reason: "invalid" | "out_of_range" };

export function parseIsoDateTimeString(input: string): ParseIsoDateTimeResult {
  const parts = isoDateTimePattern.exec(input);
  if (!parts) {
    return { ok: false, reason: "invalid" };
  }
  const [, year, month, day, hour, minute, second, fraction = "", zone] = parts;
  if (
    year === "-000000" ||
    !isValidCalendarDate(Number(year), Number(month), Number(day)) ||
    !isValidClockTime(Number(hour), Number(minute), Number(second)) ||
    !isValidUtcOffset(zone)
  ) {
    return { ok: false, reason: "invalid" };
  }

  const date = new Date(
    `${year}-${month}-${day}T${hour}:${minute}:${second}.${fraction.padEnd(3, "0")}${zone}`,
  );
  if (Number.isNaN(date.getTime())) {
    return { ok: false, reason: "out_of_range" };
  }
  return { ok: true, date };
}

export function formatDateToUtcIso(input: unknown): string | null {
  try {
    return Date.prototype.toISOString.call(input);
  } catch (error) {
    if (error instanceof TypeError || error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}
