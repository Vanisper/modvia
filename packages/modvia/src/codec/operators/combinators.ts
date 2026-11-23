import { INVALID } from "../core/collector.ts";
import {
  assertValueCodec,
  createCodec,
  createPipedCodec,
  executeCodec,
  promoteToCodec,
} from "../core/runtime.ts";
import type {
  Codec,
  CodecTrait,
  InferEncoded,
  InferValue,
  ValueCodecInput,
  WithCodecTrait,
} from "../core/types.ts";

/**
 * 将上游 Codec 与下游状态化 Codec 首尾串联为双向管道，保留下游自有链式方法
 *
 * @description 解码按 first → second 正向执行，编码按 second → first 逆向执行
 */
export function pipe<Mid, Encoded, Out, SecondEncoded extends Mid, Trait extends CodecTrait>(
  first: ValueCodecInput<Mid, Encoded>,
  second: WithCodecTrait<Out, SecondEncoded, Trait>,
): WithCodecTrait<Out, Encoded, Trait>;
/**
 * 将两个值级 Codec 首尾串联为双向管道
 *
 * @description 解码按 first → second 正向执行，编码按 second → first 逆向执行
 */
export function pipe<Mid, Encoded, Out>(
  first: ValueCodecInput<Mid, Encoded>,
  second: ValueCodecInput<Out, Mid>,
): Codec<Out, Encoded>;
export function pipe<Mid, Encoded, Out>(
  first: ValueCodecInput<Mid, Encoded>,
  second: ValueCodecInput<Out, Mid>,
): Codec<Out, Encoded> {
  return createPipedCodec(first, second);
}

/** 交换 Codec 的解码与编码方向 */
export function invert<T, Encoded>(codec: ValueCodecInput<T, Encoded>): Codec<Encoded, T> {
  assertValueCodec(codec, "invert");
  const innerCodec = promoteToCodec(codec);
  return createCodec<Encoded, T>(
    (input, direction, collector) =>
      executeCodec(innerCodec, input, direction === "decode" ? "encode" : "decode", collector),
    {
      descriptor: {
        kind: "invert",
        inner: innerCodec as Codec<unknown, unknown>,
      },
    },
  );
}

/** 惰性求值引用的 Codec，用于声明自引用递归结构 */
export function lazy<T, Encoded = T>(getter: () => ValueCodecInput<T, Encoded>): Codec<T, Encoded> {
  if (typeof getter !== "function") {
    throw new TypeError("lazy requires a function returning a Codec");
  }

  let cached: Codec<T, Encoded> | undefined;
  const resolveTarget = (): Codec<T, Encoded> => {
    if (cached === undefined) {
      const target = getter();
      assertValueCodec(target, "lazy");
      cached = promoteToCodec(target);
    }
    return cached;
  };

  return createCodec<T, Encoded>(
    (input, direction, collector) => executeCodec(resolveTarget(), input, direction, collector),
    {
      descriptor: {
        kind: "lazy",
        resolve: () => resolveTarget() as Codec<unknown, unknown>,
      },
    },
  );
}

/**
 * 按从左到右顺序联合多个值级 Codec，返回首个成功分支的结果
 *
 * @description 编解码均按声明顺序依次尝试；全部失败时报 union.no_match
 */
export function unionOf<
  const Branches extends readonly [
    ValueCodecInput<unknown, unknown>,
    ValueCodecInput<unknown, unknown>,
    ...ValueCodecInput<unknown, unknown>[],
  ],
>(...branches: Branches): Codec<InferValue<Branches[number]>, InferEncoded<Branches[number]>> {
  if (branches.length < 2) {
    throw new RangeError("unionOf requires at least two codecs");
  }
  for (const branch of branches) {
    assertValueCodec(branch, "unionOf");
  }

  const promotedBranches = Object.freeze(branches.map((branch) => promoteToCodec(branch)));

  type UnionValue = InferValue<Branches[number]>;
  type UnionEncoded = InferEncoded<Branches[number]>;

  return createCodec<UnionValue, UnionEncoded>(
    (input, direction, collector) => {
      const mark = collector.mark();
      for (const branch of promotedBranches) {
        const result = executeCodec(branch, input, direction, collector);
        if (result !== INVALID) {
          collector.restore(mark);
          return result as UnionValue | UnionEncoded;
        }
        collector.restore(mark);
      }
      return collector.add("union.no_match", "Input did not match any union branch");
    },
    {
      descriptor: {
        kind: "union",
        branches: promotedBranches,
      },
    },
  );
}
