import { createValidationIssue } from "./collector.ts";
import type { ValidationIssue } from "./types.ts";

/** 公开的跨上下文识别协议：ValidationError.is 依赖全局注册符号，允许跨 realm / 副本识别 */
const errorBrand = Symbol.for("modvia.ValidationError");

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
        createValidationIssue(
          Object.freeze([...issue.path]),
          issue.code,
          issue.message,
          issue.params,
        ),
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
