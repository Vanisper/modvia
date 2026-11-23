import { describe, expect, test } from "vite-plus/test";
import { compileBooleanTokens, parseBooleanToken } from "../../src/scalars/boolean.ts";
import { checkLengthBounds, validateLengthBounds } from "../../src/scalars/bounds/length.ts";
import {
  checkOrderedBounds,
  validateContinuousBounds,
  validateDiscreteBigIntBounds,
  validateDiscreteIntBounds,
} from "../../src/scalars/bounds/ordered.ts";
import { isValidIpv4, isValidIpv6 } from "../../src/scalars/ip.ts";
import { parseBigIntString } from "../../src/scalars/numeric/bigint.ts";
import { parseSafeIntString } from "../../src/scalars/numeric/int.ts";
import { parseFiniteNumberString } from "../../src/scalars/numeric/number.ts";
import {
  checkIsoDateString,
  checkIsoTimeString,
  isLeapYear,
  parseIsoDateTimeEpochMs,
} from "../../src/scalars/temporal.ts";

describe("pure scalar atoms (zero Codec coupling)", () => {
  test("有序区间与非负长度区间纯代数校验", () => {
    validateLengthBounds({ minLength: 2, maxLength: 5 });
    expect(() => validateLengthBounds({ minLength: 6, maxLength: 3 })).toThrow(RangeError);
    expect(checkLengthBounds(1, { minLength: 2, maxLength: 5 })).toBe("min_length");
    expect(checkLengthBounds(6, { minLength: 2, maxLength: 5 })).toBe("max_length");
    expect(checkLengthBounds(4, { minLength: 2, maxLength: 5 })).toBeUndefined();

    validateContinuousBounds({
      lower: { value: 0, exclusive: true },
      upper: { value: 1, exclusive: false },
    });
    expect(() =>
      validateContinuousBounds({
        lower: { value: 1, exclusive: true },
        upper: { value: 1, exclusive: false },
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateDiscreteIntBounds({
        lower: { value: 1, exclusive: true },
        upper: { value: 2, exclusive: true },
      }),
    ).toThrow(RangeError);
    expect(() =>
      validateDiscreteBigIntBounds({
        lower: { value: 10n, exclusive: true },
        upper: { value: 11n, exclusive: true },
      }),
    ).toThrow(RangeError);

    expect(
      checkOrderedBounds(0, {
        lower: { value: 0, exclusive: true },
      }),
    ).toBe("gt");
  });

  test("词法解析与公历日历纯函数在全库一致复用", () => {
    expect(parseSafeIntString("-0")).toBe(0);
    expect(parseSafeIntString("9007199254740993")).toBeNull();
    expect(parseFiniteNumberString("-0.0")).toBe(0);
    expect(parseFiniteNumberString("1e999")).toBeNull();
    expect(parseBigIntString("9007199254740993")).toBe(9007199254740993n);

    const table = compileBooleanTokens(["ON"], ["OFF"], false);
    expect(parseBooleanToken("on", table)).toBe(true);
    expect(parseBooleanToken("1", table)).toBeNull();

    expect(isLeapYear(2000)).toBe(true);
    expect(isLeapYear(1900)).toBe(false);
    expect(checkIsoDateString("2024-02-29")).toBe("ok");
    expect(checkIsoDateString("2025-02-29")).toBe("invalid_calendar");
    expect(checkIsoTimeString("23:59:59.5")).toBe("ok");
    expect(checkIsoTimeString("24:00:00")).toBe("invalid_clock");
    expect(Object.is(parseIsoDateTimeEpochMs("1970-01-01T00:00:00.000Z"), 0)).toBe(true);
    expect(parseIsoDateTimeEpochMs("1970-01-01T00:00:00.5Z")).toBe(500);
    expect(parseIsoDateTimeEpochMs("1970-01-01T00:00:00.05Z")).toBe(50);
    expect(parseIsoDateTimeEpochMs("1970-01-01T00:00:00.005999Z")).toBe(5);
    expect(Number.isNaN(parseIsoDateTimeEpochMs("1970-01-01T00:00:00."))).toBe(true);
    expect(Number.isNaN(parseIsoDateTimeEpochMs("1970-01-01T00:00:00.12xZ"))).toBe(true);
    expect(parseIsoDateTimeEpochMs("+999999-01-01T00:00:00Z")).toBe(Number.POSITIVE_INFINITY);

    expect(isValidIpv4("192.168.1.1")).toBe(true);
    expect(isValidIpv4("192.168.01.1")).toBe(false);
    expect(isValidIpv6("::ffff:192.0.2.128")).toBe(true);
    expect(isValidIpv6("2001::85a3::7334")).toBe(false);
  });
});
