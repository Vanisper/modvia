import { assertValueCodec, createCodec, promoteToCodec } from "../core/codec.ts";
import { kernelOf } from "../core/internals.ts";
import { invertKernel, lazyKernel, unionKernel } from "../core/kernel.ts";
import type {
  Codec,
  CodecTrait,
  InferEncoded,
  InferValue,
  ValueCodecInput,
  WithCodecTrait,
} from "../core/types.ts";

/**
 * 将上游 Codec 接入下游带自有方法 Codec 的上游槽，保留下游全部值域方法
 *
 * @description 解码按 first → second 正向执行，编码按 second → first 逆向执行
 */
export function pipe<Mid, Encoded, Out, SecondEncoded extends Mid, Trait extends CodecTrait>(
  first: ValueCodecInput<Mid, Encoded>,
  second: WithCodecTrait<Out, SecondEncoded, Trait, object>,
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
export function pipe(
  first: ValueCodecInput<unknown, unknown>,
  second: ValueCodecInput<unknown, unknown>,
): Codec<unknown, unknown> {
  assertValueCodec(first, "pipe");
  return promoteToCodec(first).pipe(second) as unknown as Codec<unknown, unknown>;
}

/** 交换 Codec 的解码与编码方向 */
export function invert<T, Encoded>(codec: ValueCodecInput<T, Encoded>): Codec<Encoded, T> {
  assertValueCodec(codec, "invert");
  const inner = promoteToCodec(codec);
  return createCodec(invertKernel(kernelOf(inner)), {
    kind: "invert",
    inner: inner as Codec<unknown, unknown>,
  });
}

/** 惰性求值引用的 Codec，用于声明自引用递归结构 */
export function lazy<T, Encoded = T>(getter: () => ValueCodecInput<T, Encoded>): Codec<T, Encoded> {
  if (typeof getter !== "function") {
    throw new TypeError("lazy requires a function returning a Codec");
  }
  let target: Codec<T, Encoded> | undefined;
  const resolve = (): Codec<T, Encoded> => {
    if (target === undefined) {
      const resolved = getter();
      assertValueCodec(resolved, "lazy");
      target = promoteToCodec(resolved);
    }
    return target;
  };
  return createCodec(
    lazyKernel(() => kernelOf(resolve())),
    { kind: "lazy", resolve: resolve as () => Codec<unknown, unknown> },
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
  const promoted = Object.freeze(branches.map((branch) => promoteToCodec(branch)));
  return createCodec(unionKernel(promoted.map((branch) => kernelOf(branch))), {
    kind: "union",
    branches: promoted,
  }) as unknown as Codec<InferValue<Branches[number]>, InferEncoded<Branches[number]>>;
}
