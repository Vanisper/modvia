import type {
  CodecContext,
  CodecIssueInput,
  PathSegment,
  StatefulCodecContext,
  ValidationIssue,
} from "./types.ts";

export const errorBrand = Symbol.for("modvia.ValidationError");
const abortBrand = Symbol("modvia.abort");

/** 内部失败哨兵：模块私有、不可被外部伪造 */
export const INVALID: unique symbol = Symbol("modvia.invalid");
export type Invalid = typeof INVALID;

const EMPTY_PATH: readonly PathSegment[] = Object.freeze([]);
const CLOSED_CONTEXT_MESSAGE = "Codec context cannot be used after its callback has returned";

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

/** 单次顶层调用独占的问题收集器：每次调用新建，不做池化复用 */
export class IssueCollector {
  readonly #path: PathSegment[] = [];
  readonly issues: ValidationIssue[] = [];

  pushSegment(segment: PathSegment): void {
    this.#path.push(segment);
  }

  popSegment(): void {
    this.#path.pop();
  }

  add(code: string, message: string): Invalid {
    const path = this.#path;
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
    this.issues.push(
      Object.freeze({ path: Object.freeze(this.#path.concat(relativePath)), code, message }),
    );
    return INVALID;
  }

  addRelativeIssues(nestedIssues: readonly ValidationIssue[]): Invalid {
    for (const issue of nestedIssues) {
      this.issues.push(
        Object.freeze({
          path: Object.freeze(this.#path.concat(issue.path)),
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

  frozenIssues(): readonly ValidationIssue[] {
    return Object.freeze(this.issues);
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

/** 回调期 context 作用域：context 只在其回调同步执行期间可用，close 之后任何调用立即抛错 */
export interface ContextScope<Context> {
  readonly context: Context;
  close(): void;
}

function openScope<S extends object>(
  collector: IssueCollector,
  mapFirstSegment: SegmentMapper | undefined,
  state: Readonly<S> | undefined,
): ContextScope<CodecContext & { readonly state?: Readonly<S> }> {
  let open = true;
  const assertOpen = (): void => {
    if (!open) throw new Error(CLOSED_CONTEXT_MESSAGE);
  };
  const context = Object.freeze({
    fail(code: string, message: string): never {
      assertOpen();
      return failWithAbortSignal(code, message);
    },
    issue(detail: CodecIssueInput): void {
      assertOpen();
      recordContextIssue(collector, detail, mapFirstSegment);
    },
    ...(state !== undefined ? { state } : {}),
  });
  return {
    context,
    close() {
      open = false;
    },
  };
}

export function openContext(
  collector: IssueCollector,
  mapFirstSegment?: SegmentMapper,
): ContextScope<CodecContext> {
  return openScope(collector, mapFirstSegment, undefined);
}

export function openStatefulContext<S extends object>(
  collector: IssueCollector,
  state: Readonly<S>,
): ContextScope<StatefulCodecContext<S>> {
  return openScope(collector, undefined, state) as ContextScope<StatefulCodecContext<S>>;
}
