export interface OrderedBound<N extends number | bigint> {
  readonly value: N;
  readonly exclusive: boolean;
}

export interface OrderedBounds<N extends number | bigint> {
  readonly lower?: OrderedBound<N>;
  readonly upper?: OrderedBound<N>;
}

export type OrderedViolation = "min" | "max" | "gt" | "lt";

export function validateContinuousBounds(bounds: Readonly<OrderedBounds<number>>): void {
  const { lower, upper } = bounds;
  if (lower !== undefined && (typeof lower.value !== "number" || !Number.isFinite(lower.value))) {
    throw new RangeError("lower bound must be a finite number");
  }
  if (upper !== undefined && (typeof upper.value !== "number" || !Number.isFinite(upper.value))) {
    throw new RangeError("upper bound must be a finite number");
  }
  if (lower !== undefined && upper !== undefined) {
    if (upper.value < lower.value) {
      throw new RangeError("Upper bound must be greater than or equal to lower bound");
    }
    if (upper.value === lower.value && (lower.exclusive || upper.exclusive)) {
      throw new RangeError("Empty numeric interval: exclusive bound cannot equal opposite bound");
    }
  }
}

export function validateDiscreteIntBounds(bounds: Readonly<OrderedBounds<number>>): void {
  const { lower, upper } = bounds;
  if (
    lower !== undefined &&
    (typeof lower.value !== "number" || !Number.isSafeInteger(lower.value))
  ) {
    throw new RangeError("lower bound must be a safe integer");
  }
  if (
    upper !== undefined &&
    (typeof upper.value !== "number" || !Number.isSafeInteger(upper.value))
  ) {
    throw new RangeError("upper bound must be a safe integer");
  }
  if (lower?.exclusive && lower.value === Number.MAX_SAFE_INTEGER) {
    throw new RangeError("No safe integer is greater than MAX_SAFE_INTEGER");
  }
  if (upper?.exclusive && upper.value === Number.MIN_SAFE_INTEGER) {
    throw new RangeError("No safe integer is less than MIN_SAFE_INTEGER");
  }
  if (lower !== undefined && upper !== undefined) {
    const effectiveMin = lower.exclusive ? lower.value + 1 : lower.value;
    const effectiveMax = upper.exclusive ? upper.value - 1 : upper.value;
    if (effectiveMax < effectiveMin) {
      throw new RangeError(
        "Empty integer interval: upper bound leaves no valid integer above lower bound",
      );
    }
  }
}

export function validateDiscreteBigIntBounds(bounds: Readonly<OrderedBounds<bigint>>): void {
  const { lower, upper } = bounds;
  if (lower !== undefined && typeof lower.value !== "bigint") {
    throw new TypeError("lower bound must be a bigint");
  }
  if (upper !== undefined && typeof upper.value !== "bigint") {
    throw new TypeError("upper bound must be a bigint");
  }
  if (lower !== undefined && upper !== undefined) {
    const effectiveMin = lower.exclusive ? lower.value + 1n : lower.value;
    const effectiveMax = upper.exclusive ? upper.value - 1n : upper.value;
    if (effectiveMax < effectiveMin) {
      throw new RangeError(
        "Empty bigint interval: upper bound leaves no valid bigint above lower bound",
      );
    }
  }
}

export function checkOrderedBounds<N extends number | bigint>(
  value: N,
  bounds: Readonly<OrderedBounds<N>>,
): OrderedViolation | undefined {
  const { lower, upper } = bounds;
  if (lower !== undefined) {
    if (lower.exclusive) {
      if (!(value > lower.value)) return "gt";
    } else if (value < lower.value) {
      return "min";
    }
  }
  if (upper !== undefined) {
    if (upper.exclusive) {
      if (!(value < upper.value)) return "lt";
    } else if (value > upper.value) {
      return "max";
    }
  }
  return undefined;
}
