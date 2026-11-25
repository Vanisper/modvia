import { INVALID } from "./collector.ts";
import { openContext, runInScope, type SegmentMapper } from "./context.ts";
import type { Kernel } from "./internals.ts";
import { builtinIssues, reportIssue } from "./issues.ts";
import type { CodecContext, FieldLiteral, IssueCode } from "./types.ts";

/** 执行内核代数：所有组合都只操作成对的步骤函数，不感知 Codec 实例与方法面 */

/** 双向管道：解码 first → second，编码 second → first */
export function pipeKernel<Mid, Encoded, Out>(
  first: Kernel<Mid, Encoded>,
  second: Kernel<Out, Mid>,
): Kernel<Out, Encoded> {
  return {
    decode(input, collector) {
      const mid = first.decode(input, collector);
      return mid === INVALID ? INVALID : second.decode(mid, collector);
    },
    encode(input, collector) {
      const mid = second.encode(input, collector);
      return mid === INVALID ? INVALID : first.encode(mid, collector);
    },
  };
}

/** 方向反转：交换解码与编码 */
export function invertKernel<T, Encoded>(inner: Kernel<T, Encoded>): Kernel<Encoded, T> {
  return { decode: inner.encode, encode: inner.decode };
}

/** 对称谓词精化：基础转换通过后，以业务值（解码输出 / 编码输入）校验谓词 */
export function refineKernel<T, Encoded>(
  base: Kernel<T, Encoded>,
  predicate: (value: T) => boolean,
  code: IssueCode,
  message: string,
): Kernel<T, Encoded> {
  return {
    decode(input, collector) {
      const value = base.decode(input, collector);
      if (value === INVALID) return INVALID;
      return predicate(value) ? value : collector.add(code, message);
    },
    encode(input, collector) {
      const encoded = base.encode(input, collector);
      if (encoded === INVALID) return INVALID;
      return predicate(input as T) ? encoded : collector.add(code, message);
    },
  };
}

/** 对称过程式检查：基础转换通过后在回调作用域内执行规则，解码侧路径按需翻译为外部键名 */
export function checkKernel<T, Encoded>(
  base: Kernel<T, Encoded>,
  rule: (value: T, context: CodecContext) => void,
  decodePathMapper: () => SegmentMapper | undefined,
): Kernel<T, Encoded> {
  return {
    decode(input, collector) {
      const value = base.decode(input, collector);
      if (value === INVALID) return INVALID;
      const scope = openContext(collector, { pathMapper: decodePathMapper });
      return runInScope(scope, collector, (context) => {
        rule(value, context);
        return value;
      });
    },
    encode(input, collector) {
      const encoded = base.encode(input, collector);
      if (encoded === INVALID) return INVALID;
      return runInScope(openContext(collector), collector, (context) => {
        rule(input as T, context);
        return encoded;
      });
    },
  };
}

/** 同类型幂等规范化：解码后规范化输出；编码先校验原值，再按规范形态编码 */
export function normalizeKernel<T, Encoded>(
  base: Kernel<T, Encoded>,
  normalize: (value: T) => T,
): Kernel<T, Encoded> {
  return {
    decode(input, collector) {
      const value = base.decode(input, collector);
      return value === INVALID ? INVALID : normalize(value);
    },
    encode(input, collector) {
      const encoded = base.encode(input, collector);
      if (encoded === INVALID) return INVALID;
      const normalized = normalize(input as T);
      return Object.is(normalized, input) ? encoded : base.encode(normalized, collector);
    },
  };
}

/** 字面量哨兵优先：两端均先按 Object.is 匹配字面量，未命中再交由内层 */
export function literalKernel<T, Encoded, Literal extends FieldLiteral>(
  base: Kernel<T, Encoded>,
  literals: readonly Literal[],
): Kernel<T | Literal, Encoded | Literal> {
  const matchOr =
    <Out>(fallback: Kernel<T, Encoded>["decode" | "encode"]) =>
    (input: unknown, collector: Parameters<typeof fallback>[1]) => {
      for (const literal of literals) {
        if (Object.is(input, literal)) return literal;
      }
      return fallback(input, collector) as Out;
    };
  return {
    decode: matchOr<T>(base.decode),
    encode: matchOr<Encoded>(base.encode),
  };
}

/** 惰性内核：首次执行时解析目标内核并缓存，用于自引用递归结构 */
export function lazyKernel<T, Encoded>(resolve: () => Kernel<T, Encoded>): Kernel<T, Encoded> {
  let target: Kernel<T, Encoded> | undefined;
  const ensure = (): Kernel<T, Encoded> => (target ??= resolve());
  return {
    decode: (input, collector) => ensure().decode(input, collector),
    encode: (input, collector) => ensure().encode(input, collector),
  };
}

/** 顺序联合：按声明顺序试探分支，首个成功分支胜出并回滚前序试探记录，全部失败报 union.no_match */
export function unionKernel<T, Encoded>(
  branches: readonly Kernel<T, Encoded>[],
): Kernel<T, Encoded> {
  const firstMatch =
    (side: "decode" | "encode") => (input: unknown, collector: Parameters<Kernel["decode"]>[1]) => {
      const mark = collector.mark();
      for (const branch of branches) {
        const output = branch[side](input, collector);
        collector.restore(mark);
        if (output !== INVALID) return output;
      }
      return reportIssue(collector, builtinIssues.unionNoMatch());
    };
  return {
    decode: firstMatch("decode") as Kernel<T, Encoded>["decode"],
    encode: firstMatch("encode") as Kernel<T, Encoded>["encode"],
  };
}
