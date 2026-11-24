import type {
  CodecContext,
  CodecIssueInput,
  PathSegment,
  StatefulCodecContext,
  ValidationIssue,
} from "./types.ts";

export const errorBrand = Symbol.for("modvia.ValidationError");
const abortBrand = Symbol.for("modvia.CodecAbort");

export const INVALID = Symbol.for("modvia.invalid");
export type Invalid = typeof INVALID;

const EMPTY_PATH: readonly PathSegment[] = Object.freeze([]);
const INACTIVE_CONTEXT_MESSAGE =
  "Codec context cannot be used outside its active callback execution";

interface AbortSignal {
  readonly [abortBrand]: true;
  readonly code: string;
  readonly message: string;
}

function failWithAbortSignal(code: string, message: string): never {
  const signal: AbortSignal = { [abortBrand]: true, code, message };
  // oxlint-disable-next-line no-throw-literal -- 内部零调用栈开销中断信号，由紧邻执行器捕获转为 Issue
  throw signal;
}

export function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<AbortSignal>)[abortBrand] === true
  );
}

export type SegmentMapper = (segment: PathSegment) => PathSegment;

let activeContextToken: object | null = null;

export function hasActiveContext(): boolean {
  return activeContextToken !== null;
}

export function enterActiveContext(token: object): object | null {
  const previous = activeContextToken;
  activeContextToken = token;
  return previous;
}

export function leaveActiveContext(previous: object | null): void {
  activeContextToken = previous;
}

export function suspendActiveContext(): object | null {
  const previous = activeContextToken;
  activeContextToken = null;
  return previous;
}

function assertActiveContext(expected: object): void {
  if (activeContextToken !== expected) {
    throw new Error(INACTIVE_CONTEXT_MESSAGE);
  }
}

function recordContextIssue(
  collector: IssueCollector,
  detail: CodecIssueInput,
  mapFirstSegment?: SegmentMapper,
): void {
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
}

export function createScopedContext(
  collector: IssueCollector,
  mapFirstSegment?: SegmentMapper,
): CodecContext {
  const context: CodecContext = Object.freeze({
    fail(code: string, message: string): never {
      assertActiveContext(context);
      return failWithAbortSignal(code, message);
    },
    issue(detail: CodecIssueInput): void {
      assertActiveContext(context);
      recordContextIssue(collector, detail, mapFirstSegment);
    },
  });
  return context;
}

export function createStatefulScopedContext<S extends object>(
  collector: IssueCollector,
  state: Readonly<S>,
): StatefulCodecContext<S> {
  const context: StatefulCodecContext<S> = Object.freeze({
    fail(code: string, message: string): never {
      assertActiveContext(context);
      return failWithAbortSignal(code, message);
    },
    issue(detail: CodecIssueInput): void {
      assertActiveContext(context);
      recordContextIssue(collector, detail);
    },
    state,
  });
  return context;
}

export function createPrimaryContext(mapFirstSegment?: SegmentMapper): CodecContext {
  return createScopedContext(primaryCollector, mapFirstSegment);
}

export function createPrimaryStatefulContext<S extends object>(
  state: Readonly<S>,
): StatefulCodecContext<S> {
  return createStatefulScopedContext(primaryCollector, state);
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

export class InternalCollector implements IssueCollector {
  private readonly path: PathSegment[] = [];
  issues: ValidationIssue[] = [];

  pushSegment(segment: PathSegment): void {
    this.path.push(segment);
  }

  popSegment(): void {
    this.path.pop();
  }

  add(code: string, message: string): Invalid {
    const path = this.path;
    this.issues.push(
      Object.freeze({
        path: path.length === 0 ? EMPTY_PATH : Object.freeze(path.slice()),
        code,
        message,
      }),
    );
    return INVALID;
  }

  addAt(relativePath: readonly PathSegment[], code: string, message: string): Invalid {
    const path = this.path;
    this.issues.push(
      Object.freeze({
        path: Object.freeze(path.length === 0 ? relativePath.slice() : path.concat(relativePath)),
        code,
        message,
      }),
    );
    return INVALID;
  }

  addRelativeIssues(nestedIssues: readonly ValidationIssue[]): Invalid {
    const path = this.path;
    const hasPrefix = path.length > 0;
    for (const issue of nestedIssues) {
      this.issues.push(
        Object.freeze({
          path: hasPrefix
            ? Object.freeze(path.concat(issue.path))
            : issue.path.length === 0
              ? EMPTY_PATH
              : Object.freeze(issue.path.slice()),
          code: issue.code,
          message: issue.message,
        }),
      );
    }
    return INVALID;
  }

  mark(): number {
    return this.issues.length;
  }

  restore(index: number): void {
    this.issues.length = index;
  }

  reset(): void {
    this.path.length = 0;
    this.issues.length = 0;
  }

  takeFrozenIssues(): readonly ValidationIssue[] {
    const captured = Object.freeze(this.issues);
    this.issues = [];
    this.path.length = 0;
    return captured;
  }
}

export const primaryCollector = new InternalCollector();
let idleCollector: InternalCollector | null = primaryCollector;

export function acquireCollector(): InternalCollector {
  const collector = idleCollector;
  if (collector !== null) {
    idleCollector = null;
    return collector;
  }
  return new InternalCollector();
}

export function releaseCollector(collector: InternalCollector): void {
  collector.reset();
  idleCollector = collector;
}

export function releaseFailedCollector(collector: InternalCollector): readonly ValidationIssue[] {
  const frozenIssues = collector.takeFrozenIssues();
  idleCollector = collector;
  return frozenIssues;
}
