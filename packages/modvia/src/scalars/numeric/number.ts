const numberTextPattern = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function assertFiniteNumber(value: number, label: string): void {
  if (!isFiniteNumber(value)) {
    throw new RangeError(`${label} must be a finite number`);
  }
}

export function parseFiniteNumberString(input: string): number | null {
  if (!numberTextPattern.test(input)) return null;
  const parsed = Number(input);
  if (!Number.isFinite(parsed)) return null;
  return Object.is(parsed, -0) ? 0 : parsed;
}

export function formatFiniteNumber(value: number): string {
  return Object.is(value, -0) ? "0" : String(value);
}
