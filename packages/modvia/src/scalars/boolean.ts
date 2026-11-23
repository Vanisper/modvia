export interface BooleanTokenTable {
  readonly rawTruthy: readonly [string, ...string[]];
  readonly rawFalsy: readonly [string, ...string[]];
  readonly caseSensitive: boolean;
  readonly truthySet: ReadonlySet<string>;
  readonly falsySet: ReadonlySet<string>;
}

export function compileBooleanTokens(
  rawTruthy: readonly [string, ...string[]],
  rawFalsy: readonly [string, ...string[]],
  caseSensitive: boolean,
): BooleanTokenTable {
  if (!Array.isArray(rawTruthy) || rawTruthy.length === 0) {
    throw new RangeError("truthy list must contain at least one string");
  }
  if (!Array.isArray(rawFalsy) || rawFalsy.length === 0) {
    throw new RangeError("falsy list must contain at least one string");
  }
  const normalizeToken = (token: string): string => {
    if (typeof token !== "string" || token.length === 0) {
      throw new TypeError("Boolean string tokens must be non-empty strings");
    }
    return caseSensitive ? token : token.toLowerCase();
  };
  const frozenTruthy = Object.freeze([...rawTruthy]) as readonly [string, ...string[]];
  const frozenFalsy = Object.freeze([...rawFalsy]) as readonly [string, ...string[]];
  const truthySet = new Set(frozenTruthy.map(normalizeToken));
  const falsySet = new Set(frozenFalsy.map(normalizeToken));
  for (const token of truthySet) {
    if (falsySet.has(token)) {
      throw new RangeError(`Overlapping boolean token "${token}" in truthy and falsy sets`);
    }
  }
  return { rawTruthy: frozenTruthy, rawFalsy: frozenFalsy, caseSensitive, truthySet, falsySet };
}

export function parseBooleanToken(
  input: string,
  table: Readonly<BooleanTokenTable>,
): boolean | null {
  const key = table.caseSensitive ? input : input.toLowerCase();
  if (table.truthySet.has(key)) return true;
  if (table.falsySet.has(key)) return false;
  return null;
}

export function formatBooleanToken(value: boolean, table: Readonly<BooleanTokenTable>): string {
  return value ? table.rawTruthy[0] : table.rawFalsy[0];
}
