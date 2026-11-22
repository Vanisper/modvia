import type { CodecContext, CodecIssueInput, PathSegment, ValidationIssue } from "./types.ts";

export const errorBrand = Symbol.for("modvia.ValidationError");
const abortBrand = Symbol.for("modvia.CodecAbort");

export const INVALID = Symbol("modvia.invalid");
export type Invalid = typeof INVALID;

interface AbortSignal {
  readonly [abortBrand]: true;
  readonly code: string;
  readonly message: string;
}

export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<AbortSignal>)[abortBrand] === true
  );
}

export type SegmentMapper = (segment: PathSegment) => PathSegment;

export function createScopedContext(
  collector: IssueCollector,
  mapFirstSegment?: SegmentMapper,
): CodecContext {
  return {
    fail(code: string, message: string): never {
      const signal: AbortSignal = { [abortBrand]: true, code, message };
      // oxlint-disable-next-line no-throw-literal -- 内部零调用栈开销中断信号，由紧邻执行器捕获转为 Issue
      throw signal;
    },
    issue(detail: CodecIssueInput): void {
      if (
        typeof detail !== "object" ||
        detail === null ||
        typeof detail.code !== "string" ||
        detail.code.length === 0 ||
        typeof detail.message !== "string"
      ) {
        throw new TypeError("context.issue requires a non-empty code and a message string");
      }
      const rawPath = detail.path;
      if (!rawPath || rawPath.length === 0) {
        collector.add(detail.code, detail.message);
        return;
      }
      const mappedPath =
        mapFirstSegment !== undefined
          ? [mapFirstSegment(rawPath[0] as PathSegment), ...rawPath.slice(1)]
          : rawPath;
      collector.addAt(mappedPath, detail.code, detail.message);
    },
  };
}

export interface IssueCollector {
  pushSegment(segment: PathSegment): void;
  popSegment(): void;
  add(code: string, message: string): Invalid;
  addAt(relativePath: readonly PathSegment[], code: string, message: string): Invalid;
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
    addAt(relativePath: readonly PathSegment[], code: string, message: string): Invalid {
      issues.push(
        Object.freeze({
          path: Object.freeze(path.length === 0 ? [...relativePath] : [...path, ...relativePath]),
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
