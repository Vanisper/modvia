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
  ...input: Values
): Field<Values[number], Values[number]> {
  if (input.length === 0) throw new RangeError("oneOf requires at least one value");
  const values = new Set<string>(input);
  const convert = (input: unknown, context: CodecContext): Values[number] => {
    if (typeof input !== "string" || !values.has(input)) {
      return context.fail("one_of", `Expected one of: ${[...values].join(", ")}`);
    }
    return input as Values[number];
  };
  return field(defineCodec<Values[number], Values[number]>({ decode: convert, encode: convert }));
}

export function isoDateTime(): Field<Date, string> {
  return field(
    defineCodec<Date, string>({
      decode(input, context) {
        if (typeof input !== "string") {
          return context.fail("type.datetime", "Expected an ISO date-time");
        }
        if (!isIsoDateTime(input)) return context.fail("datetime.invalid", "Invalid ISO date-time");
        return new Date(input);
      },
      encode(input, context) {
        if (!(input instanceof Date) || !Number.isFinite(input.getTime())) {
          return context.fail("type.datetime", "Expected a valid Date");
        }
        return input.toISOString();
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

function isIsoDateTime(input: string): boolean {
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/.exec(
      input,
    );
  if (!match) return false;

  const [, yearText, monthText, dayText, hourText, minuteText, secondText, zone] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (hour > 23 || minute > 59 || second > 59) return false;

  if (zone !== "Z") {
    const offsetHour = Number(zone.slice(1, 3));
    const offsetMinute = Number(zone.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }

  const calendar = new Date(0);
  calendar.setUTCHours(0, 0, 0, 0);
  calendar.setUTCFullYear(year, month - 1, day);
  if (
    calendar.getUTCFullYear() !== year ||
    calendar.getUTCMonth() !== month - 1 ||
    calendar.getUTCDate() !== day
  ) {
    return false;
  }
  return Number.isFinite(Date.parse(input));
}
