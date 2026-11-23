const bigintTextPattern = /^[+-]?\d+$/;

export function isBigIntValue(value: unknown): value is bigint {
  return typeof value === "bigint";
}

export function assertBigIntValue(value: bigint, label: string): void {
  if (typeof value !== "bigint") {
    throw new TypeError(`${label} must be a bigint`);
  }
}

export function parseBigIntString(input: string): bigint | null {
  if (!bigintTextPattern.test(input)) return null;
  return BigInt(input);
}

export function formatBigIntValue(value: bigint): string {
  return value.toString();
}
