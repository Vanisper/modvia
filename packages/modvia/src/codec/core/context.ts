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

let closeContext: (context: CheckContext) => void;
let assertContextOpen: (context: CheckContext) => void;
let collectorOf: (context: CheckContext) => IssueCollector;

/**
 * 回调期轻量执行上下文基类：方法位于冻结原型，生命周期与收集器完全封装在私有字段内
 *
 * @description 每次回调独立实例化（无跨调用复用），避免重复分配闭包与 per-call Object.freeze
 */
class CheckContext implements CodecContext {
  #open = true;
  readonly #collector: IssueCollector;
  readonly #pathMapper: (() => SegmentMapper | undefined) | undefined;
  #mapperResolved = false;
  #mapper: SegmentMapper | undefined;

  static {
    closeContext = (context) => {
      context.#open = false;
    };
    assertContextOpen = (context) => {
      if (!context.#open) throw new Error(CLOSED_CONTEXT_MESSAGE);
    };
    collectorOf = (context) => context.#collector;
  }

  constructor(collector: IssueCollector, pathMapper?: () => SegmentMapper | undefined) {
    this.#collector = collector;
    this.#pathMapper = pathMapper;
  }

  fail(code: IssueCode, message: string, params?: IssueParams): never {
    if (!this.#open) throw new Error(CLOSED_CONTEXT_MESSAGE);
    const frozenParams = freezeIssueParams(params);
    const signal: AbortSignal =
      frozenParams === undefined
        ? { [abortBrand]: true, code, message }
        : { [abortBrand]: true, code, message, params: frozenParams };
    // oxlint-disable-next-line no-throw-literal -- 内部零调用栈开销中断信号，由紧邻执行器捕获转为 Issue
    throw signal;
  }

  issue(detail: CodecIssueInput): Failed {
    if (!this.#open) throw new Error(CLOSED_CONTEXT_MESSAGE);
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
      this.#collector.add(detail.code, detail.message, detail.params);
      return FAILED;
    }
    const mapper = this.#resolveMapper();
    const path =
      mapper !== undefined ? [mapper(rawPath[0] as PathSegment), ...rawPath.slice(1)] : rawPath;
    this.#collector.addAt(path, detail.code, detail.message, detail.params);
    return FAILED;
  }

  failed(this: void, value: unknown): value is Failed {
    return value === FAILED;
  }

  #resolveMapper(): SegmentMapper | undefined {
    if (!this.#mapperResolved) {
      this.#mapper = this.#pathMapper?.();
      this.#mapperResolved = true;
    }
    return this.#mapper;
  }
}

/** Codec.define handler 专用上下文：扩展只读冻结 state 与按方向运行子 Codec 的 run 方法 */
class HandlerContext<S extends object> extends CheckContext {
  readonly #side: Side;
  readonly #state: Readonly<S>;
  #lastChild: unknown;
  #lastStep: Step<unknown> | undefined;

  constructor(collector: IssueCollector, side: Side, state: Readonly<S>) {
    super(collector);
    this.#side = side;
    this.#state = state;
  }

  get state(): Readonly<S> {
    return this.#state;
  }

  run(child: CodecLike<unknown, unknown>, input: unknown, at?: PathSegment): unknown {
    assertContextOpen(this);
    if (child !== this.#lastChild) {
      if (isFieldLike(child) || typeof child !== "object" || child === null) {
        throw new TypeError("context.run requires a value Codec, not a Field");
      }
      this.#lastStep = kernelOf(child)[this.#side];
      this.#lastChild = child;
    }
    const collector = collectorOf(this);
    if (at === undefined) {
      const output = this.#lastStep!(input, collector);
      return output === INVALID ? FAILED : output;
    }
    collector.pushSegment(at);
    try {
      const output = this.#lastStep!(input, collector);
      return output === INVALID ? FAILED : output;
    } finally {
      collector.popSegment();
    }
  }
}

Object.freeze(CheckContext.prototype);
Object.freeze(HandlerContext.prototype);

/**
 * 在回调上下文内执行用户函数，统一收敛内核契约：
 * - 执行期间记录过任何问题时丢弃返回值并判为失败（多错收集天然成立，零抛错返回直接走此分支）
 * - context.fail 的中断信号与嵌套 ValidationError 转为问题，其他异常原样传播
 * - 返回 Failed 标记却未记录任何问题时抛 TypeError，守住「失败 ⇒ 至少一条问题」
 * - 回调结束后立即关闭 context 私有守卫
 */
function runWithContext<Input, Context extends CheckContext, Output>(
  context: Context,
  collector: IssueCollector,
  input: Input,
  invoke: (input: Input, context: Context) => Output,
): Output | Invalid {
  const mark = collector.mark();
  let output: Output;
  try {
    output = invoke(input, context);
  } catch (error) {
    if (isAbortSignal(error)) {
      return collector.add(error.code, error.message, error.params);
    }
    if (ValidationError.is(error)) {
      return collector.addRelativeIssues(error.issues);
    }
    throw error;
  } finally {
    closeContext(context);
  }
  if (collector.mark() > mark) return INVALID;
  if ((output as unknown) === FAILED) {
    throw new TypeError("A codec handler returned a Failed marker without any recorded issue");
  }
  return output;
}

/** 在回调作用域内执行 .check 规则，返回是否记录了校验问题 */
export function runCheckRule<T>(
  collector: IssueCollector,
  value: T,
  rule: (value: T, context: CodecContext) => void,
  pathMapper?: () => SegmentMapper | undefined,
): boolean {
  return (
    runWithContext(new CheckContext(collector, pathMapper), collector, value, rule) === INVALID
  );
}

/** 由一对用户 handler 构造执行内核：每次调用创建独立 HandlerContext，方向即 handler 所在一侧 */
export function handlerKernel<T, Encoded, S extends object>(
  decodeFn: (input: unknown, context: DecodeContext<S>) => T | Failed,
  encodeFn: (input: unknown, context: EncodeContext<S>) => Encoded | Failed,
  state: Readonly<S>,
): Kernel<T, Encoded> {
  return {
    decode: (input, collector) =>
      runWithContext(
        new HandlerContext(collector, "decode", state) as unknown as DecodeContext<S> &
          CheckContext,
        collector,
        input,
        decodeFn,
      ) as T | Invalid,
    encode: (input, collector) =>
      runWithContext(
        new HandlerContext(collector, "encode", state) as unknown as EncodeContext<S> &
          CheckContext,
        collector,
        input,
        encodeFn,
      ) as Encoded | Invalid,
  };
}
