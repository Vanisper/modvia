import { createCodec } from "../core/runtime.ts";
import type { Codec, PathSegment, StandardSchemaV1, ValidationIssue } from "../core/types.ts";

/**
 * 将任意同步 StandardSchemaV1 校验器桥接为对称双向 Codec
 *
 * @description 零运行时依赖直接对接 Valibot、ArkType 或对称 Zod 标量规则；若返回异步 Promise 则抛出 TypeError
 */
export function fromStandard<T>(schema: StandardSchemaV1<T, T>): Codec<T, T> {
  if (
    typeof schema !== "object" ||
    schema === null ||
    typeof schema["~standard"] !== "object" ||
    schema["~standard"] === null ||
    typeof schema["~standard"].validate !== "function"
  ) {
    throw new TypeError("fromStandard requires a valid StandardSchemaV1 object");
  }

  const standard = schema["~standard"];

  return createCodec<T, T>((input, _direction, collector) => {
    const result = standard.validate(input);
    if (isPromiseLike(result)) {
      throw new TypeError("fromStandard only supports synchronous StandardSchemaV1 validators");
    }

    if (result.issues) {
      const normalizedIssues: ValidationIssue[] = result.issues.map((issue) => ({
        path: normalizeStandardPath(issue.path),
        code: extractIssueCode(issue),
        message: issue.message,
      }));
      return collector.addRelativeIssues(normalizedIssues);
    }

    return result.value;
  });
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Partial<PromiseLike<unknown>>).then === "function"
  );
}

function normalizeStandardPath(
  rawPath: ReadonlyArray<PropertyKey | StandardSchemaV1.PathSegmentObject> | undefined,
): readonly PathSegment[] {
  if (!rawPath || rawPath.length === 0) return [];
  return rawPath.map((entry) => {
    const key = typeof entry === "object" && entry !== null && "key" in entry ? entry.key : entry;
    return typeof key === "symbol" ? String(key) : key;
  });
}

function extractIssueCode(issue: StandardSchemaV1.Issue): string {
  const candidate = (issue as { readonly code?: unknown }).code;
  return typeof candidate === "string" && candidate.length > 0 ? candidate : "standard.invalid";
}
