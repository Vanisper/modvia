import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import { jsonOf, uuid } from "../../src/formats.ts";
import {
  Alias,
  arrayOf,
  bigint,
  boolean,
  int,
  isoDateTime,
  literal,
  Model,
  number,
  recordOf,
  string,
  tupleOf,
  type Codec,
} from "../../src/index.ts";

/** 往返收敛律：任意合法业务值 t 满足 decode(encode(t)) ≡ t */
function assertEncodeRoundTrip<T>(
  codec: Codec<T, unknown>,
  values: fc.Arbitrary<T>,
  equals: (left: T, right: T) => boolean = Object.is,
): void {
  fc.assert(
    fc.property(values, (value) => {
      const restored = codec.decode(codec.encode(value));
      expect(equals(restored, value)).toBe(true);
    }),
  );
}

/** 解码不动点：任意可解码外部值 e 满足 decode(encode(decode(e))) ≡ decode(e)，即编码输出始终是规范形态 */
function assertDecodeFixedPoint<T, E>(
  codec: Codec<T, E>,
  inputs: fc.Arbitrary<unknown>,
  equals: (left: T, right: T) => boolean = Object.is,
): void {
  fc.assert(
    fc.property(inputs, (input) => {
      const decoded = codec.safeParse(input);
      if (!decoded.ok) return;
      const canonical = codec.encode(decoded.value);
      expect(equals(codec.decode(canonical), decoded.value)).toBe(true);
      expect(codec.encode(codec.decode(canonical))).toStrictEqual(canonical);
    }),
  );
}

const deepEqual = <T>(left: T, right: T): boolean => {
  try {
    expect(left).toStrictEqual(right);
    return true;
  } catch {
    return false;
  }
};

const canonicalZero = (value: number): number => (value === 0 ? 0 : value);
const sameInstant = (left: Date, right: Date): boolean => left.getTime() === right.getTime();
const validDate = fc.date({ noInvalidDate: true });

describe("往返收敛律（属性测试）", () => {
  test("原始标量在原生与字符串介质下均满足编码往返与解码不动点", () => {
    assertEncodeRoundTrip(int(), fc.maxSafeInteger());
    assertEncodeRoundTrip(int().fromString(), fc.maxSafeInteger());
    assertEncodeRoundTrip(number(), fc.double({ noNaN: true, noDefaultInfinity: true }));
    assertEncodeRoundTrip(
      number().fromString(),
      fc.double({ noNaN: true, noDefaultInfinity: true }).map(canonicalZero),
    );
    assertEncodeRoundTrip(bigint().fromString(), fc.bigInt());
    assertEncodeRoundTrip(boolean().fromString(), fc.boolean());
    assertEncodeRoundTrip(
      boolean().fromString().tokens(["yes", "on"], ["no", "off"]).caseSensitive(),
      fc.boolean(),
    );
    assertEncodeRoundTrip(isoDateTime(), validDate, sameInstant);

    assertDecodeFixedPoint(int().fromString(), fc.stringMatching(/^[+-]?\d{1,17}$/));
    assertDecodeFixedPoint(
      number().fromString(),
      fc.stringMatching(/^[+-]?\d{1,12}(?:\.\d{1,8})?(?:[eE][+-]?\d{1,3})?$/),
    );
    assertDecodeFixedPoint(bigint().fromString(), fc.stringMatching(/^[+-]?\d{1,40}$/));
    assertDecodeFixedPoint(
      boolean().fromString(),
      fc.constantFrom("true", "TRUE", "False", "fAlSe", "yes"),
    );
    assertDecodeFixedPoint(
      isoDateTime(),
      validDate.chain((date) =>
        fc
          .constantFrom("Z", "+00:00", "-23:59", "+05:30")
          .map((zone) => date.toISOString().replace("Z", zone)),
      ),
      sameInstant,
    );
  });

  test("同类型规范化在两端幂等收敛", () => {
    const Slug = string()
      .trim()
      .normalize((value) => value.toLowerCase());
    assertDecodeFixedPoint(Slug, fc.string());
    assertDecodeFixedPoint(
      uuid(),
      fc.uuid().map((value) => value.toUpperCase()),
    );
    assertEncodeRoundTrip(
      Slug,
      fc.string().map((value) => value.trim().toLowerCase()),
    );
  });

  test("容器、模型、多态联合与 JSON 文本管道满足编码往返", () => {
    assertEncodeRoundTrip(arrayOf(int()), fc.array(fc.maxSafeInteger()), deepEqual);
    assertEncodeRoundTrip(
      tupleOf(string(), isoDateTime().nullable()),
      fc.tuple(fc.string(), fc.option(validDate, { nil: null })),
      (left, right) =>
        left[0] === right[0] &&
        (left[1] === null || right[1] === null
          ? left[1] === right[1]
          : sameInstant(left[1], right[1])),
    );
    assertEncodeRoundTrip(
      recordOf(int()),
      fc.dictionary(fc.string(), fc.maxSafeInteger(), { noNullPrototype: true }),
      deepEqual,
    );

    const Account = Model.define({
      alias: Alias.snakeCase,
      fields: {
        accountId: string().trim().nonEmpty(),
        balanceCents: int().fromString(),
        tags: arrayOf(string()).default(() => []),
        note: string().optional(),
        status: literal("active", "archived"),
      },
    });
    const accountData = fc.record(
      {
        accountId: fc
          .string({ minLength: 1 })
          .map((value) => value.trim())
          .filter((value) => value.length > 0),
        balanceCents: fc.maxSafeInteger(),
        tags: fc.array(fc.string()),
        note: fc.string(),
        status: fc.constantFrom("active" as const, "archived" as const),
      },
      { requiredKeys: ["accountId", "balanceCents", "tags", "status"], noNullPrototype: true },
    );
    assertEncodeRoundTrip(Account, accountData, deepEqual);
    assertEncodeRoundTrip(jsonOf(Account), accountData, deepEqual);

    const Event = Model.union("kind", [
      Model.define({ fields: { kind: literal("circle").alias("type"), radius: number() } }),
      Model.define({ fields: { kind: literal("square").alias("type"), side: int() } }),
    ]);
    assertEncodeRoundTrip(
      Event,
      fc.oneof(
        fc.record(
          {
            kind: fc.constant("circle" as const),
            radius: fc.double({ noNaN: true, noDefaultInfinity: true }),
          },
          { noNullPrototype: true },
        ),
        fc.record(
          { kind: fc.constant("square" as const), side: fc.maxSafeInteger() },
          { noNullPrototype: true },
        ),
      ),
      deepEqual,
    );
  });
});
