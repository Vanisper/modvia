import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import {
  checkIsoDateString,
  checkIsoTimeString,
  parseIsoDateTimeEpochMs,
  type IsoDateCheckResult,
  type IsoTimeCheckResult,
} from "../../src/scalars/temporal.ts";

// 参考预言机：以命名分组正则 + 400 年周期平移后的 Date.UTC 独立实现同一契约，
// 与 scalars/temporal 的手写扫描器做等价对照（NaN / Infinity / -0 归一均按 Object.is 比较）。

const MAX_EPOCH_MS = 8_640_000_000_000_000;
const MS_PER_DAY = 86_400_000;
const DAYS_PER_400_YEARS = 146_097;

const isoDateTimeOracle =
  /^(?<year>\d{4}|[+-]\d{6})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d+))?(?<zone>Z|[+-]\d{2}:\d{2})$/;
const isoDateOracle = /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})$/;
const isoTimeOracle = /^(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.\d+)?$/;

function shiftedYear(year: number): { readonly anchor: number; readonly cycles: number } {
  const anchor = (((year % 400) + 400) % 400) + 2000;
  return { anchor, cycles: (year - anchor) / 400 };
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(shiftedYear(year).anchor, month, 0)).getUTCDate();
}

function isCalendarDate(year: number, month: number, day: number): boolean {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function isClockTime(hour: number, minute: number, second: number): boolean {
  return hour <= 23 && minute <= 59 && second <= 59;
}

function epochDays(year: number, month: number, day: number): number {
  const { anchor, cycles } = shiftedYear(year);
  return Date.UTC(anchor, month - 1, day) / MS_PER_DAY + cycles * DAYS_PER_400_YEARS;
}

function parseIsoDateTimeOracle(input: string): number {
  const groups = isoDateTimeOracle.exec(input)?.groups;
  if (!groups || groups.year === "-000000") return Number.NaN;
  const year = Number(groups.year);
  const month = Number(groups.month);
  const day = Number(groups.day);
  const hour = Number(groups.hour);
  const minute = Number(groups.minute);
  const second = Number(groups.second);
  if (!isCalendarDate(year, month, day) || !isClockTime(hour, minute, second)) {
    return Number.NaN;
  }

  let offsetMs = 0;
  if (groups.zone !== "Z") {
    const zoneHour = Number(groups.zone!.slice(1, 3));
    const zoneMinute = Number(groups.zone!.slice(4, 6));
    if (zoneHour > 23 || zoneMinute > 59) return Number.NaN;
    offsetMs = (zoneHour * 60 + zoneMinute) * 60_000 * (groups.zone!.startsWith("-") ? -1 : 1);
  }

  const millisecond = groups.fraction ? Number(groups.fraction.slice(0, 3).padEnd(3, "0")) : 0;
  const epochMs =
    epochDays(year, month, day) * MS_PER_DAY +
    hour * 3_600_000 +
    minute * 60_000 +
    second * 1000 +
    millisecond -
    offsetMs;
  if (Math.abs(epochMs) > MAX_EPOCH_MS) return Number.POSITIVE_INFINITY;
  return epochMs === 0 ? 0 : epochMs;
}

function checkIsoDateOracle(input: string): IsoDateCheckResult {
  const groups = isoDateOracle.exec(input)?.groups;
  if (!groups) return "invalid_syntax";
  return isCalendarDate(Number(groups.year), Number(groups.month), Number(groups.day))
    ? "ok"
    : "invalid_calendar";
}

function checkIsoTimeOracle(input: string): IsoTimeCheckResult {
  const groups = isoTimeOracle.exec(input)?.groups;
  if (!groups) return "invalid_syntax";
  return isClockTime(Number(groups.hour), Number(groups.minute), Number(groups.second))
    ? "ok"
    : "invalid_clock";
}

const DIGIT_CHARS = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"] as const;
const MUTATION_CHARS = [...DIGIT_CHARS, "-", "+", ":", ".", "T", "Z", " ", "x"] as const;

const digits = (length: number) =>
  fc
    .array(fc.constantFrom(...DIGIT_CHARS), { minLength: length, maxLength: length })
    .map((chars) => chars.join(""));
const paddedInt = (max: number) =>
  fc.integer({ min: 0, max }).map((n) => String(n).padStart(2, "0"));

const yearPart = fc.oneof(
  digits(4),
  fc.tuple(fc.constantFrom("+", "-"), digits(6)).map(([sign, value]) => sign + value),
  fc.constantFrom("-000000", "+000000", "-000004", "-000100", "-000400", "+275760", "-271821"),
);
const fractionPart = fc.oneof(
  fc.constant(""),
  fc.integer({ min: 0, max: 7 }).chain((length) => digits(length).map((value) => `.${value}`)),
);
const zonePart = fc.oneof(
  fc.constant("Z"),
  fc
    .tuple(fc.constantFrom("+", "-"), paddedInt(29), paddedInt(69))
    .map(([sign, hour, minute]) => `${sign}${hour}:${minute}`),
);
const structuredDateTime = fc
  .tuple(
    yearPart,
    paddedInt(19),
    paddedInt(39),
    paddedInt(29),
    paddedInt(69),
    paddedInt(69),
    fractionPart,
    zonePart,
  )
  .map(
    ([year, month, day, hour, minute, second, fraction, zone]) =>
      `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction}${zone}`,
  );
const mutated = (source: fc.Arbitrary<string>) =>
  fc.tuple(source, fc.nat(), fc.constantFrom(...MUTATION_CHARS)).map(([text, index, char]) => {
    if (text.length === 0) return char;
    const at = index % text.length;
    return text.slice(0, at) + char + text.slice(at + 1);
  });
const validInstants = fc
  .date({ noInvalidDate: true })
  .chain((date) =>
    fc
      .constantFrom("Z", "+00:00", "-00:00", "+23:59", "-23:59", "+05:30")
      .map((zone) => date.toISOString().replace("Z", zone)),
  );

describe("temporal 扫描器与命名分组正则预言机等价", () => {
  test("isoDateTime 扫描器在合法、越界、畸形与随机变异输入上与预言机逐值一致", () => {
    const corpus = fc.oneof(
      structuredDateTime,
      mutated(structuredDateTime),
      validInstants,
      mutated(validInstants),
      fc.string(),
    );
    fc.assert(
      fc.property(corpus, (input) => {
        expect(Object.is(parseIsoDateTimeEpochMs(input), parseIsoDateTimeOracle(input))).toBe(true);
      }),
      { numRuns: 5000 },
    );
  });

  test("isoDate 与 isoTime 判定与预言机逐值一致", () => {
    const dates = fc.oneof(
      fc
        .tuple(digits(4), paddedInt(19), paddedInt(39))
        .map(([year, month, day]) => `${year}-${month}-${day}`),
      fc.string(),
    );
    const times = fc.oneof(
      fc
        .tuple(paddedInt(29), paddedInt(69), paddedInt(69), fractionPart)
        .map(([hour, minute, second, fraction]) => `${hour}:${minute}:${second}${fraction}`),
      fc.string(),
    );
    fc.assert(
      fc.property(fc.oneof(dates, mutated(dates)), (input) => {
        expect(checkIsoDateString(input)).toBe(checkIsoDateOracle(input));
      }),
      { numRuns: 3000 },
    );
    fc.assert(
      fc.property(fc.oneof(times, mutated(times)), (input) => {
        expect(checkIsoTimeString(input)).toBe(checkIsoTimeOracle(input));
      }),
      { numRuns: 3000 },
    );
  });
});
