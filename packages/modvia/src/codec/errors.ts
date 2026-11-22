import type { CodecContext, PathSegment, ValidationIssue } from "./types.ts";

const errorBrand = Symbol.for("modvia.ValidationError");
const abortBrand = Symbol.for("modvia.CodecAbort");

export const INVALID = Symbol("modvia.invalid");
export type Invalid = typeof INVALID;

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

interface AbortSignal {
  readonly [abortBrand]: true;
  readonly code: string;
  readonly message: string;
}

export const sharedContext: CodecContext = Object.freeze({
  fail(code: string, message: string): never {
    const signal: AbortSignal = { [abortBrand]: true, code, message };
    // oxlint-disable-next-line no-throw-literal -- 内部零调用栈开销中断信号，由紧邻执行器捕获转为 Issue
    throw signal;
  },
});

export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<AbortSignal>)[abortBrand] === true
  );
}

export interface IssueCollector {
  pushSegment(segment: PathSegment): void;
  popSegment(): void;
  add(code: string, message: string): Invalid;
  addRelativeIssues(issues: readonly ValidationIssue[]): Invalid;
  mark(): number;
  restore(index: number): void;
  readonly issues: ValidationIssue[];
}

export function createCollector(): IssueCollector {
  const path: PathSegment[] = [];
  const issues: ValidationIssue[] = [];

  return {
    issues,
    pushSegment(segment: PathSegment) {
      path.push(segment);
    },
    popSegment() {
      path.pop();
    },
    add(code: string, message: string): Invalid {
      issues.push(
        Object.freeze({
          path: Object.freeze([...path]),
          code,
          message,
        }),
      );
      return INVALID;
    },
    addRelativeIssues(nestedIssues: readonly ValidationIssue[]): Invalid {
      for (const issue of nestedIssues) {
        issues.push(
          Object.freeze({
            path: Object.freeze(path.length === 0 ? [...issue.path] : [...path, ...issue.path]),
            code: issue.code,
            message: issue.message,
          }),
        );
      }
      return INVALID;
    },
    mark(): number {
      return issues.length;
    },
    restore(index: number): void {
      issues.length = index;
    },
  };
}

function formatIssue(issue: ValidationIssue): string {
  const path = issue.path.reduce<string>(
    (text, segment) =>
      typeof segment === "number" ? `${text}[${segment}]` : text ? `${text}.${segment}` : segment,
    "",
  );
  return `${path || "input"}: ${issue.message}`;
}
