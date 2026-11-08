import type { ModelIssue, PathSegment } from "./types.ts";

const errorBrand = Symbol.for("modvia.ModelValidationError");

export class ModelValidationError extends Error {
  override readonly name = "ModelValidationError";
  readonly issues: readonly ModelIssue[];

  constructor(issues: readonly ModelIssue[]) {
    super(issues.map(formatIssue).join("\n"));
    this.issues = issues.map((issue) => ({
      ...issue,
      path: Object.freeze([...issue.path]),
    }));
    Object.freeze(this.issues);
    Object.defineProperty(this, errorBrand, { value: true });
  }
}

export function isModelValidationError(value: unknown): value is ModelValidationError {
  if (typeof value !== "object" || value === null) return false;
  try {
    return Reflect.get(value, errorBrand) === true;
  } catch {
    return false;
  }
}

export function fail(path: readonly PathSegment[], code: string, message: string): never {
  throw new ModelValidationError([{ path, code, message }]);
}

export function nestValidationError(
  value: unknown,
  segment: PathSegment,
): ModelValidationError | undefined {
  if (!isModelValidationError(value)) return undefined;
  return new ModelValidationError(
    value.issues.map((issue) => ({
      ...issue,
      path: [segment, ...issue.path],
    })),
  );
}

function formatIssue(issue: ModelIssue): string {
  const path = issue.path.reduce<string>(
    (text, segment) =>
      typeof segment === "number" ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment,
    "",
  );
  return `${path || "input"}: ${issue.message}`;
}
