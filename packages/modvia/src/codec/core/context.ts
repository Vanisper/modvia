import { freezeIssueParams, INVALID, type Invalid, type IssueCollector } from "./collector.ts";
import { ValidationError } from "./errors.ts";
import { isFieldLike } from "./field.ts";
import { kernelOf, type Kernel, type Side, type Step } from "./internals.ts";
import type {
  CodecContext,
  CodecIssueInput,
  CodecLike,
  DecodeContext,
  EncodeContext,
  Failed,
  IssueCode,
  IssueParams,
  PathSegment,
} from "./types.ts";

export type SegmentMapper = (segment: PathSegment) => PathSegment;

const abortBrand = Symbol("modvia.abort");
const FAILED = Object.freeze({}) as Failed;
const CLOSED_CONTEXT_MESSAGE = "Codec context cannot be used after its callback has returned";

interface AbortSignal {
  readonly [abortBrand]: true;
  readonly code: IssueCode;
  readonly message: string;
  readonly params?: IssueParams;
}

function isAbortSignal(value: unknown): value is AbortSignal {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<AbortSignal>)[abortBrand] === true
  );
}

export interface ContextOptions<S extends object> {
  /** handler 所在的一侧：决定 context.run 运行子 Codec 的方向；省略时不提供 run（如 .check 回调） */
  readonly side?: Side;
  /** 状态化 handler 的冻结状态 */
  readonly state?: Readonly<S>;
  /** 解码侧 issue 首段路径翻译器（惰性求值，首次使用时解析，以支持尚未就绪的递归引用） */
  readonly pathMapper?: () => SegmentMapper | undefined;
}

/** 回调期 context 作用域：context 只在其回调同步执行期间可用，close 之后任何调用立即抛错 */
export interface ContextScope<Context> {
  readonly context: Context;
  close(): void;
}

type AnyContext = CodecContext &
  Partial<Pick<DecodeContext, "run" | "state">> &
  Partial<Pick<EncodeContext, "run">>;

/** 打开一个回调期 context：fail 中断、issue 非中断收集、run 在同一收集器与路径下运行子 Codec */
export function openContext<S extends object>(
  collector: IssueCollector,
  options: ContextOptions<S> = {},
): ContextScope<AnyContext> {
  let open = true;
  let mapper: SegmentMapper | undefined;
  let mapperResolved = false;
  let lastChild: unknown;
  let lastStep: Step<unknown> | undefined;
  const { side, state, pathMapper } = options;

  const assertOpen = (): void => {
    if (!open) throw new Error(CLOSED_CONTEXT_MESSAGE);
  };
  const resolveMapper = (): SegmentMapper | undefined => {
    if (!mapperResolved) {
      mapper = pathMapper?.();
      mapperResolved = true;
    }
    return mapper;
  };

  const context: AnyContext = {
    fail(code: IssueCode, message: string, params?: IssueParams): never {
      assertOpen();
      const frozenParams = freezeIssueParams(params);
      const signal: AbortSignal =
        frozenParams === undefined
          ? { [abortBrand]: true, code, message }
          : { [abortBrand]: true, code, message, params: frozenParams };
      // oxlint-disable-next-line no-throw-literal -- 内部零调用栈开销中断信号，由紧邻执行器捕获转为 Issue
      throw signal;
    },
    issue(detail: CodecIssueInput): void {
      assertOpen();
      recordIssue(collector, detail, resolveMapper);
    },
    failed(value: unknown): value is Failed {
      return value === FAILED;
    },
    ...(state !== undefined ? { state } : {}),
  };

  if (side !== undefined) {
    context.run = ((child: CodecLike<unknown, unknown>, input: unknown, at?: PathSegment) => {
      assertOpen();
      if (child !== lastChild) {
        if (isFieldLike(child) || typeof child !== "object" || child === null) {
          throw new TypeError("context.run requires a value Codec, not a Field");
        }
        lastStep = kernelOf(child)[side];
        lastChild = child;
      }
      if (at === undefined) {
        const output = lastStep!(input, collector);
        return output === INVALID ? FAILED : output;
      }
      collector.pushSegment(at);
      try {
        const output = lastStep!(input, collector);
        return output === INVALID ? FAILED : output;
      } finally {
        collector.popSegment();
      }
    }) as AnyContext["run"];
  }

  return {
    context: Object.freeze(context),
    close() {
      open = false;
    },
  };
}

function recordIssue(
  collector: IssueCollector,
  detail: CodecIssueInput,
  resolveMapper: () => SegmentMapper | undefined,
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
    collector.add(detail.code, detail.message, detail.params);
    return;
  }
  const mapper = resolveMapper();
  const path =
    mapper !== undefined ? [mapper(rawPath[0] as PathSegment), ...rawPath.slice(1)] : rawPath;
  collector.addAt(path, detail.code, detail.message, detail.params);
}

/**
 * 在回调作用域内执行用户回调，统一收敛内核契约：
 * - 回调期间记录过任何问题时丢弃其返回值并判为失败（多错收集天然成立）
 * - context.fail 的中断信号与嵌套 ValidationError 转为问题，其他异常原样传播
 * - 返回 Failed 标记却未记录任何问题时抛 TypeError，守住「失败 ⇒ 至少一条问题」
 * - 回调结束后关闭 context
 */
export function runInScope<Context, Output>(
  scope: ContextScope<Context>,
  collector: IssueCollector,
  invoke: (context: Context) => Output,
): Output | Invalid {
  const mark = collector.mark();
  let output: Output;
  try {
    output = invoke(scope.context);
  } catch (error) {
    if (isAbortSignal(error)) {
      return collector.add(error.code, error.message, error.params);
    }
    if (ValidationError.is(error)) {
      return collector.addRelativeIssues(error.issues);
    }
    throw error;
  } finally {
    scope.close();
  }
  if (collector.mark() > mark) return INVALID;
  if ((output as unknown) === FAILED) {
    throw new TypeError("A codec handler returned a Failed marker without any recorded issue");
  }
  return output;
}

/** 由一对用户 handler 构造执行内核：每次调用打开独立 context，方向即 handler 所在一侧 */
export function handlerKernel<T, Encoded, S extends object>(
  decodeFn: (input: unknown, context: DecodeContext<S>) => T,
  encodeFn: (input: unknown, context: EncodeContext<S>) => Encoded,
  state: Readonly<S>,
): Kernel<T, Encoded> {
  return {
    decode: (input, collector) =>
      runInScope(openContext(collector, { side: "decode", state }), collector, (context) =>
        decodeFn(input, context as DecodeContext<S>),
      ),
    encode: (input, collector) =>
      runInScope(openContext(collector, { side: "encode", state }), collector, (context) =>
        encodeFn(input, context as EncodeContext<S>),
      ),
  };
}
