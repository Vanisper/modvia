import { errorBrand } from "./collector.ts";
import type { ValidationIssue } from "./types.ts";

export class ValidationError extends Error {
  override readonly name = "ValidationError";
  readonly issues: readonly ValidationIssue[];

  constructor(issues: readonly ValidationIssue[]) {
    super(issues.map(formatIssue).join("\n"));
    this.issues = Object.freeze(
      issues.map((issue) =>
        Object.freeze({
          path: Object.freeze([...issue.path]),
          code: issue.code,
          message: issue.message,
        }),
      ),
    );
    Object.defineProperty(this, errorBrand, { value: true });
  }
}

export function isValidationError(value: unknown): value is ValidationError {
  if (typeof value !== "object" || value === null) return false;
  try {
    return Reflect.get(value, errorBrand) === true;
  } catch {
    return false;
  }
}

function formatIssue(issue: ValidationIssue): string {
  const path = issue.path.reduce<string>(
    (text, segment) =>
      typeof segment === "number" ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment,
    "",
  );
  return `${path || "input"}: ${issue.message}`;
}
