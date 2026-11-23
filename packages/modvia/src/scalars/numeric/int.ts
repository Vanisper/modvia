const integerTextPattern = /^[+-]?\d+$/;

export function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

export function assertSafeInteger(value: number, label: string): void {
  if (!isSafeInteger(value)) {
    throw new RangeError(`${label} must be a safe integer`);
  }
}

export function parseSafeIntString(input: string): number | null {
  if (!integerTextPattern.test(input)) return null;
  const parsed = Number(input);
  if (!Number.isSafeInteger(parsed)) return null;
  return Object.is(parsed, -0) ? 0 : parsed;
}

export function formatSafeInt(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}
