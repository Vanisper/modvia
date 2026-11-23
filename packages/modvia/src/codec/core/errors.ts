import { errorBrand } from "./collector.ts";
import type { ValidationIssue } from "./types.ts";

export class ValidationError extends Error {
  override readonly name = "ValidationError";
  readonly issues: readonly ValidationIssue[];

  /** 跨上下文判断目标值是否为 Modvia 校验异常实例 */
  static is(this: void, value: unknown): value is ValidationError {
    if (typeof value !== "object" || value === null) return false;
    try {
      return Reflect.get(value, errorBrand) === true;
    } catch {
      return false;
    }
  }

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

function formatIssue(issue: ValidationIssue): string {
  const path = issue.path.reduce<string>(
    (text, segment) =>
      typeof segment === "number" ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment,
    "",
  );
  return `${path || "input"}: ${issue.message}`;
}
