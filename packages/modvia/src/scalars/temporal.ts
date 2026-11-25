/** 公历与 ISO 8601 文本的纯计算原子：零 Codec 耦合、无共享可变状态 */

const MONTH_LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

/** 原生 Date 可表示的毫秒时间戳绝对值上限（ECMAScript 规范 ±8.64e15） */
const MAX_EPOCH_MS = 8_640_000_000_000_000;
/** 早于此年份或晚于此年份的任何时刻都必然越出原生 Date 范围，可在换算前直接判定 */
const MIN_REPRESENTABLE_YEAR = -271_822;
const MAX_REPRESENTABLE_YEAR = 275_761;

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** 扫描器使用的 ASCII 码点 */
const Char = {
  digit0: 0x30,
  plus: 0x2b,
  minus: 0x2d,
  dot: 0x2e,
  colon: 0x3a,
  upperT: 0x54,
  upperZ: 0x5a,
} as const;

export function isLeapYear(year: number): boolean {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

export function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (month < 1 || month > 12 || day < 1) return false;
  const lastDay = month === 2 && isLeapYear(year) ? 29 : MONTH_LENGTHS[month - 1]!;
  return day <= lastDay;
}

export function isValidClockTime(hour: number, minute: number, second: number): boolean {
  return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

/**
 * 单趟前向文本扫描器：按语法段逐个消费输入，任一段不匹配即由调用方判定失败。
 * 仅在单次解析调用内存活，不跨调用共享。
 */
class TextScanner {
  #position = 0;

  constructor(private readonly text: string) {}

  get atEnd(): boolean {
    return this.#position === this.text.length;
  }

  /** 若当前字符为指定码点则消费并返回 true */
  accept(code: number): boolean {
    if (this.text.charCodeAt(this.#position) !== code) return false;
    this.#position++;
    return true;
  }

  /** 消费恰好 count 位十进制数字并返回其数值；不足或遇到非数字时返回 -1 且不前进 */
  digits(count: number): number {
    let value = 0;
    for (let index = 0; index < count; index++) {
      const digit = this.#digitAt(this.#position + index);
      if (digit < 0) return -1;
      value = value * 10 + digit;
    }
    this.#position += count;
    return value;
  }

  /** 消费一段至少 1 位的连续数字，返回前 3 位按毫秒对齐的数值（不足补零，多余截断）；无数字返回 -1 */
  fractionMilliseconds(): number {
    let millisecond = 0;
    let length = 0;
    for (
      let digit = this.#digitAt(this.#position);
      digit >= 0;
      digit = this.#digitAt(this.#position)
    ) {
      if (length < 3) millisecond = millisecond * 10 + digit;
      length++;
      this.#position++;
    }
    if (length === 0) return -1;
    for (; length < 3; length++) millisecond *= 10;
    return millisecond;
  }

  #digitAt(index: number): number {
    const digit = this.text.charCodeAt(index) - Char.digit0;
    return digit >= 0 && digit <= 9 ? digit : -1;
  }
}

interface CalendarFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface ClockFields {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly millisecond: number;
}

/** 年份：四位数字，或带正负号的六位扩展年份（拒绝 -000000） */
function scanYear(scanner: TextScanner, allowExpanded: boolean): number | undefined {
  if (allowExpanded) {
    const negative = scanner.accept(Char.minus);
    if (negative || scanner.accept(Char.plus)) {
      const magnitude = scanner.digits(6);
      if (magnitude < 0 || (negative && magnitude === 0)) return undefined;
      return negative ? -magnitude : magnitude;
    }
  }
  const year = scanner.digits(4);
  return year < 0 ? undefined : year;
}

/** 日期段语法：YEAR-MM-DD（只校验语法，不校验日历） */
function scanCalendarFields(
  scanner: TextScanner,
  allowExpandedYear: boolean,
): CalendarFields | undefined {
  const year = scanYear(scanner, allowExpandedYear);
  if (year === undefined || !scanner.accept(Char.minus)) return undefined;
  const month = scanner.digits(2);
  if (month < 0 || !scanner.accept(Char.minus)) return undefined;
  const day = scanner.digits(2);
  if (day < 0) return undefined;
  return { year, month, day };
}

/** 时钟段语法：HH:mm:ss[.fraction]（只校验语法，不校验时钟范围） */
function scanClockFields(scanner: TextScanner): ClockFields | undefined {
  const hour = scanner.digits(2);
  if (hour < 0 || !scanner.accept(Char.colon)) return undefined;
  const minute = scanner.digits(2);
  if (minute < 0 || !scanner.accept(Char.colon)) return undefined;
  const second = scanner.digits(2);
  if (second < 0) return undefined;
  let millisecond = 0;
  if (scanner.accept(Char.dot)) {
    millisecond = scanner.fractionMilliseconds();
    if (millisecond < 0) return undefined;
  }
  return { hour, minute, second, millisecond };
}

/** 时区段：Z 或 ±HH:MM（-23:59 至 +23:59），返回相对 UTC 的偏移毫秒数；非法返回 undefined */
function scanZoneOffsetMs(scanner: TextScanner): number | undefined {
  if (scanner.accept(Char.upperZ)) return 0;
  const negative = scanner.accept(Char.minus);
  if (!negative && !scanner.accept(Char.plus)) return undefined;
  const hour = scanner.digits(2);
  if (hour < 0 || hour > 23 || !scanner.accept(Char.colon)) return undefined;
  const minute = scanner.digits(2);
  if (minute < 0 || minute > 59) return undefined;
  const offset = hour * MS_PER_HOUR + minute * MS_PER_MINUTE;
  return negative ? -offset : offset;
}

/**
 * 公历日期到 Unix 纪元日数的换算（Howard Hinnant 的 days-from-civil 算法）
 *
 * @description 把每年的起点平移到 3 月 1 日，使闰日落在年末；再按 400 年一个完整周期
 * （146097 天）分解，避免依赖原生 Date 对 0–99 年份的特殊映射，并对负年份保持正确。
 */
function daysFromCivil(year: number, month: number, day: number): number {
  const marchYear = month <= 2 ? year - 1 : year;
  const era = Math.floor(marchYear / 400);
  const yearOfEra = marchYear - era * 400;
  const marchMonth = month > 2 ? month - 3 : month + 9;
  const dayOfYear = Math.floor((153 * marchMonth + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  // 719468 = 0000-03-01 到 1970-01-01 的天数
  return era * 146_097 + dayOfEra - 719_468;
}

export type IsoDateCheckResult = "ok" | "invalid_syntax" | "invalid_calendar";

export function checkIsoDateString(input: string): IsoDateCheckResult {
  const scanner = new TextScanner(input);
  const fields = scanCalendarFields(scanner, false);
  if (fields === undefined || !scanner.atEnd) return "invalid_syntax";
  return isValidCalendarDate(fields.year, fields.month, fields.day) ? "ok" : "invalid_calendar";
}

export type IsoTimeCheckResult = "ok" | "invalid_syntax" | "invalid_clock";

export function checkIsoTimeString(input: string): IsoTimeCheckResult {
  const scanner = new TextScanner(input);
  const fields = scanClockFields(scanner);
  if (fields === undefined || !scanner.atEnd) return "invalid_syntax";
  return isValidClockTime(fields.hour, fields.minute, fields.second) ? "ok" : "invalid_clock";
}

/**
 * 解析 ISO 日期时间文本并返回 UTC 毫秒时间戳：
 * - 合法且在原生 Date 范围内：返回精确整数毫秒值（`-0` 归一为 `0`）
 * - 语法、日历、时钟或时区偏移非法：返回 `Number.NaN`
 * - 语法与日历合法但超出原生 Date 范围（`±8.64e15`）：返回 `Number.POSITIVE_INFINITY`
 */
export function parseIsoDateTimeEpochMs(input: string): number {
  const scanner = new TextScanner(input);
  const date = scanCalendarFields(scanner, true);
  if (date === undefined || !scanner.accept(Char.upperT)) return Number.NaN;
  const clock = scanClockFields(scanner);
  if (clock === undefined) return Number.NaN;
  const offsetMs = scanZoneOffsetMs(scanner);
  if (offsetMs === undefined || !scanner.atEnd) return Number.NaN;

  if (
    !isValidCalendarDate(date.year, date.month, date.day) ||
    !isValidClockTime(clock.hour, clock.minute, clock.second)
  ) {
    return Number.NaN;
  }
  if (date.year < MIN_REPRESENTABLE_YEAR || date.year > MAX_REPRESENTABLE_YEAR) {
    return Number.POSITIVE_INFINITY;
  }

  const epochMs =
    daysFromCivil(date.year, date.month, date.day) * MS_PER_DAY +
    clock.hour * MS_PER_HOUR +
    clock.minute * MS_PER_MINUTE +
    clock.second * MS_PER_SECOND +
    clock.millisecond -
    offsetMs;
  if (epochMs < -MAX_EPOCH_MS || epochMs > MAX_EPOCH_MS) {
    return Number.POSITIVE_INFINITY;
  }
  return epochMs === 0 ? 0 : epochMs;
}

/** 将任意（含跨上下文与子类）有效 Date 格式化为毫秒精度 UTC ISO 文本；非 Date 或无效 Date 返回 null */
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
