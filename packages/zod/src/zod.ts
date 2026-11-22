import { defineCodec, type Codec, type CodecContext, type PathSegment } from "modvia/codec";
import {
  $ZodAsyncError,
  $ZodEncodeError,
  safeEncode,
  safeParse,
  type $ZodIssue,
  type $ZodType,
  type SomeType,
  type input,
  type output,
} from "zod/v4/core";

type IrreversibleDefType = "transform" | "catch" | "success" | "promise";
type CoercibleDefType = "string" | "number" | "boolean" | "bigint" | "date";

type IsCoercedLeaf<S extends SomeType> = S["_zod"]["def"] extends {
  readonly type: CoercibleDefType;
}
  ? unknown extends input<S>
    ? true
    : false
  : false;

type HasIrreversibleNode<S> = S extends SomeType
  ? IsCoercedLeaf<S> extends true
    ? true
    : S["_zod"]["def"] extends { readonly type: IrreversibleDefType }
      ? true
      : S["_zod"]["def"] extends {
            readonly type: "pipe";
            readonly in: infer In;
            readonly out: infer Out;
          }
        ? HasIrreversibleNode<In> extends true
          ? true
          : HasIrreversibleNode<Out>
        : S["_zod"]["def"] extends { readonly innerType: infer Inner }
          ? HasIrreversibleNode<Inner>
          : S["_zod"]["def"] extends { readonly element: infer Elem }
            ? HasIrreversibleNode<Elem>
            : S["_zod"]["def"] extends {
                  readonly shape: infer Shape extends Record<string, unknown>;
                }
              ? true extends { [K in keyof Shape]: HasIrreversibleNode<Shape[K]> }[keyof Shape]
                ? true
                : false
              : false
  : false;

/** 编译期排除包含单向 transform、隐式 coerce、吞错 catch 或异步 promise 的不可逆 Zod 规则 */
export type ReversibleZodSchema<S extends $ZodType> =
  HasIrreversibleNode<S> extends true ? never : S;

/**
 * 将对称 Zod v4 Schema 或双向 `z.codec` 桥接为标准 Modvia `Codec<Output, Input>`
 *
 * @description 兼容 `"zod"` 与 `"zod/mini"`；定义期拦截单向 `.transform()`、隐式 `z.coerce.*`、吞错 `.catch()` 与 `z.promise()`，并将校验错误码统一映射为 `zod.<issue.code>`
 */
export function zodCodec<S extends $ZodType>(
  schema: S & ReversibleZodSchema<S>,
): Codec<output<S>, input<S>> {
  if (!isZodNode(schema)) {
    throw new TypeError("zodCodec requires a Zod v4 schema instance");
  }
  assertReversibleZodSchema(schema, new Set());

  return defineCodec<output<S>, input<S>>({
    decode(rawInput, context) {
      const result = runZodStep(() => safeParse(schema, rawInput));
      if (!result.success) {
        reportZodIssues(result.error.issues, context);
        return undefined as never;
      }
      return result.data;
    },
    encode(domainValue, context) {
      const result = runZodStep(() => safeEncode(schema, domainValue));
      if (!result.success) {
        reportZodIssues(result.error.issues, context);
        return undefined as never;
      }
      return result.data;
    },
  });
}

function runZodStep<R>(execute: () => R): R {
  try {
    return execute();
  } catch (error) {
    if (error instanceof $ZodAsyncError) {
      throw new TypeError("zodCodec only supports synchronous Zod schemas and refinements", {
        cause: error,
      });
    }
    if (error instanceof $ZodEncodeError) {
      throw new TypeError(
        "zodCodec encountered an irreversible Zod node during encode; use z.codec(...) instead",
        { cause: error },
      );
    }
    throw error;
  }
}

function reportZodIssues(issues: readonly $ZodIssue[], context: CodecContext): void {
  for (const issue of issues) {
    const code =
      typeof issue.code === "string" && issue.code.length > 0 ? `zod.${issue.code}` : "zod.invalid";
    context.issue({
      code,
      message: issue.message,
      path: normalizeZodPath(issue.path),
    });
  }
}

function normalizeZodPath(rawPath: readonly PropertyKey[]): readonly PathSegment[] | undefined {
  if (rawPath.length === 0) return undefined;
  return rawPath.map((segment) => (typeof segment === "symbol" ? String(segment) : segment));
}

interface ZodNodeLike {
  readonly _zod: {
    readonly def: Record<string, unknown> & { readonly type?: unknown; readonly coerce?: unknown };
  };
}

function isZodNode(value: unknown): value is ZodNodeLike {
  if (typeof value !== "object" || value === null || !("_zod" in value)) {
    return false;
  }
  const internals = (value as { readonly _zod?: unknown })._zod;
  if (typeof internals !== "object" || internals === null || !("def" in internals)) {
    return false;
  }
  const def = (internals as { readonly def?: unknown }).def;
  return typeof def === "object" && def !== null;
}

function assertReversibleZodSchema(node: ZodNodeLike, visited: Set<object>): void {
  if (visited.has(node)) return;
  visited.add(node);

  const def = node._zod.def;
  const kind = def.type;

  if (def.coerce === true) {
    throw new TypeError(
      `zodCodec rejects implicit coercion schema "z.coerce.${String(kind)}"; use explicit z.codec(...) or Modvia codecs instead`,
    );
  }

  switch (kind) {
    case "transform":
      throw new TypeError(
        "zodCodec rejects unidirectional .transform() / z.preprocess(); use bidirectional z.codec(...) or Modvia defineCodec instead",
      );
    case "catch":
      throw new TypeError(
        "zodCodec rejects error-swallowing .catch() schemas because they break validation failure semantics",
      );
    case "success":
      throw new TypeError(
        "zodCodec rejects unidirectional z.success() schemas because boolean results cannot be encoded back",
      );
    case "promise":
      throw new TypeError(
        "zodCodec rejects async z.promise() schemas; Modvia codecs execute synchronously",
      );
    case "object": {
      const shape = def.shape;
      if (typeof shape === "object" && shape !== null) {
        for (const child of Object.values(shape)) {
          if (isZodNode(child)) {
            assertReversibleZodSchema(child, visited);
          }
        }
      }
      if (isZodNode(def.catchall)) {
        assertReversibleZodSchema(def.catchall, visited);
      }
      return;
    }
    case "array": {
      if (isZodNode(def.element)) {
        assertReversibleZodSchema(def.element, visited);
      }
      return;
    }
    case "tuple": {
      if (Array.isArray(def.items)) {
        for (const item of def.items) {
          if (isZodNode(item)) {
            assertReversibleZodSchema(item, visited);
          }
        }
      }
      if (isZodNode(def.rest)) {
        assertReversibleZodSchema(def.rest, visited);
      }
      return;
    }
    case "record":
    case "map": {
      if (isZodNode(def.keyType)) {
        assertReversibleZodSchema(def.keyType, visited);
      }
      if (isZodNode(def.valueType)) {
        assertReversibleZodSchema(def.valueType, visited);
      }
      return;
    }
    case "set": {
      if (isZodNode(def.valueType)) {
        assertReversibleZodSchema(def.valueType, visited);
      }
      return;
    }
    case "union": {
      if (Array.isArray(def.options)) {
        for (const option of def.options) {
          if (isZodNode(option)) {
            assertReversibleZodSchema(option, visited);
          }
        }
      }
      return;
    }
    case "intersection": {
      if (isZodNode(def.left)) {
        assertReversibleZodSchema(def.left, visited);
      }
      if (isZodNode(def.right)) {
        assertReversibleZodSchema(def.right, visited);
      }
      return;
    }
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "nonoptional": {
      if (isZodNode(def.innerType)) {
        assertReversibleZodSchema(def.innerType, visited);
      }
      return;
    }
    case "pipe": {
      if (isZodNode(def.in)) {
        assertReversibleZodSchema(def.in, visited);
      }
      if (isZodNode(def.out)) {
        assertReversibleZodSchema(def.out, visited);
      }
      return;
    }
    default:
      return;
  }
}
