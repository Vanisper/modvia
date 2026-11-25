import type { PathSegment, ValidationIssue } from "./types.ts";

/** 内部失败哨兵：模块私有、不可被外部伪造 */
export const INVALID: unique symbol = Symbol("modvia.invalid");
export type Invalid = typeof INVALID;

const EMPTY_PATH: readonly PathSegment[] = Object.freeze([]);

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
  add(code: string, message: string): Invalid {
    const path = this.#path;
    this.#issues.push(
      Object.freeze({
        path: path.length === 0 ? EMPTY_PATH : Object.freeze(path.slice()),
        code,
        message,
      }),
    );
    return INVALID;
  }

  /** 在当前路径下追加一个相对路径段后记录一条问题 */
  addAtSegment(segment: PathSegment, code: string, message: string): Invalid {
    return this.addAt([segment], code, message);
  }

  /** 在当前路径下追加相对路径后记录一条问题 */
  addAt(relativePath: readonly PathSegment[], code: string, message: string): Invalid {
    this.#issues.push(
      Object.freeze({ path: Object.freeze(this.#path.concat(relativePath)), code, message }),
    );
    return INVALID;
  }

  /** 以当前路径为前缀吸收一组嵌套问题（如外部 CodecLike 抛出的 ValidationError） */
  addRelativeIssues(nestedIssues: readonly ValidationIssue[]): Invalid {
    for (const issue of nestedIssues) {
      this.addAt(issue.path, issue.code, issue.message);
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
