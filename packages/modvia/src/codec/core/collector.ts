import { isPlainObject } from "../../shared/object.ts";
import type { IssueCode, IssueParams, PathSegment, ValidationIssue } from "./types.ts";

/** 内部失败哨兵：模块私有、不可被外部伪造 */
export const INVALID: unique symbol = Symbol("modvia.invalid");
export type Invalid = typeof INVALID;

const EMPTY_PATH: readonly PathSegment[] = Object.freeze([]);
const FROZEN_PARAMS = new WeakSet<IssueParams>();

/** 防御性浅拷贝并冻结问题参数（数组值同步冻结），防止外部修改污染或暴露可变引用 */
export function freezeIssueParams(params: IssueParams | undefined): IssueParams | undefined {
  if (params === undefined) return undefined;
  if (typeof params === "object" && params !== null && FROZEN_PARAMS.has(params)) {
    return params;
  }
  if (!isPlainObject(params)) {
    throw new TypeError("Issue params must be a plain object");
  }
  const copy: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    copy[key] = Array.isArray(value) ? Object.freeze([...value]) : value;
  }
  const frozen = Object.freeze(copy);
  FROZEN_PARAMS.add(frozen);
  return frozen;
}

/** 构造冻结的 ValidationIssue（无参数时省略 params 键） */
export function createValidationIssue(
  path: readonly PathSegment[],
  code: IssueCode,
  message: string,
  params?: IssueParams,
): ValidationIssue {
  const frozenParams = freezeIssueParams(params);
  return Object.freeze(
    frozenParams === undefined
      ? { path, code, message }
      : { path, code, message, params: frozenParams },
  );
}

/** 单次顶层调用独占的问题收集器：维护当前路径栈并累积冻结问题，每次调用新建、不做池化复用 */
export class IssueCollector {
  readonly #path: PathSegment[] = [];
  readonly #issues: ValidationIssue[] = [];

  pushSegment(segment: PathSegment): void {
    this.#path.push(segment);
  }

  popSegment(): void {
    this.#path.pop();
  }

  /** 在当前路径记录一条问题 */
  add(code: IssueCode, message: string, params?: IssueParams): Invalid {
    const path = this.#path;
    this.#issues.push(
      createValidationIssue(
        path.length === 0 ? EMPTY_PATH : Object.freeze(path.slice()),
        code,
        message,
        params,
      ),
    );
    return INVALID;
  }

  /** 在当前路径下追加一个相对路径段后记录一条问题 */
  addAtSegment(
    segment: PathSegment,
    code: IssueCode,
    message: string,
    params?: IssueParams,
  ): Invalid {
    return this.addAt([segment], code, message, params);
  }

  /** 在当前路径下追加相对路径后记录一条问题 */
  addAt(
    relativePath: readonly PathSegment[],
    code: IssueCode,
    message: string,
    params?: IssueParams,
  ): Invalid {
    this.#issues.push(
      createValidationIssue(Object.freeze(this.#path.concat(relativePath)), code, message, params),
    );
    return INVALID;
  }

  /** 以当前路径为前缀吸收一组嵌套问题（如外部 CodecLike 抛出的 ValidationError） */
  addRelativeIssues(nestedIssues: readonly ValidationIssue[]): Invalid {
    for (const issue of nestedIssues) {
      this.addAt(issue.path, issue.code, issue.message, issue.params);
    }
    return INVALID;
  }

  mark(): number {
    return this.#issues.length;
  }

  restore(mark: number): void {
    this.#issues.length = mark;
  }

  frozenIssues(): readonly ValidationIssue[] {
    return Object.freeze(this.#issues.slice());
  }
}
