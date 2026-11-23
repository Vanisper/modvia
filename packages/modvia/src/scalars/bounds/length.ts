export interface LengthBounds {
  readonly minLength?: number;
  readonly maxLength?: number;
}

export type LengthViolation = "min_length" | "max_length";

export function assertNonNegativeSafeInt(value: number, label: string): void {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative safe integer`);
  }
}

export function validateLengthBounds(bounds: Readonly<LengthBounds>): void {
  if (bounds.minLength !== undefined) {
    assertNonNegativeSafeInt(bounds.minLength, "minLength");
  }
  if (bounds.maxLength !== undefined) {
    assertNonNegativeSafeInt(bounds.maxLength, "maxLength");
  }
  if (
    bounds.minLength !== undefined &&
    bounds.maxLength !== undefined &&
    bounds.maxLength < bounds.minLength
  ) {
    throw new RangeError("maxLength must be greater than or equal to minLength");
  }
}

export function checkLengthBounds(
  length: number,
  bounds: Readonly<LengthBounds>,
): LengthViolation | undefined {
  if (bounds.minLength !== undefined && length < bounds.minLength) {
    return "min_length";
  }
  if (bounds.maxLength !== undefined && length > bounds.maxLength) {
    return "max_length";
  }
  return undefined;
}
