export type PrimitiveLiteral = string | number | boolean | null | undefined;

export function isPrimitiveLiteral(value: unknown): value is PrimitiveLiteral {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

export function deduplicateLiterals<T extends PrimitiveLiteral>(
  existing: readonly T[],
  added: readonly T[],
): readonly T[] {
  const result = [...existing];
  for (const candidate of added) {
    if (!result.some((item) => Object.is(item, candidate))) {
      result.push(candidate);
    }
  }
  return Object.freeze(result);
}

export function formatLiteral(value: PrimitiveLiteral): string {
  if (typeof value === "string") return JSON.stringify(value);
  if (Object.is(value, -0)) return "-0";
  return String(value);
}
