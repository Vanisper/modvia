import { IssueCollector, type Invalid } from "./collector.ts";
import { ValidationError } from "./errors.ts";
import type { CodecDescriptor, CodecLike } from "./types.ts";

/** 单向执行步骤：成功返回转换结果，失败返回私有 INVALID 并已在收集器中记录问题 */
export type Step<Out> = (input: unknown, collector: IssueCollector) => Out | Invalid;

/** 成对的双向执行内核：解码与编码各自独立成函数，invert 即交换、pipe 即分别复合 */
export interface Kernel<T = unknown, Encoded = unknown> {
  readonly decode: Step<T>;
  readonly encode: Step<Encoded>;
}

export type Side = keyof Kernel;

const kernels = new WeakMap<object, Kernel>();
const descriptors = new WeakMap<object, CodecDescriptor>();
const adoptedKernels = new WeakMap<object, Kernel>();
const OPAQUE_DESCRIPTOR: CodecDescriptor = Object.freeze({ kind: "custom" });

/** 登记标准 Codec 实例的私有内核与只读结构描述符（仅由 CodecImpl 构造期调用） */
export function registerCodec(codec: object, kernel: Kernel, descriptor: CodecDescriptor): void {
  kernels.set(codec, kernel);
  descriptors.set(codec, descriptor);
}

/** 判断目标值是否为本副本构造的标准 Codec 实例 */
export function isRegisteredCodec(value: unknown): boolean {
  return typeof value === "object" && value !== null && kernels.has(value);
}

/** 读取任意 Codec 的执行内核；外部 CodecLike 按公开协议适配（其抛出的 ValidationError 转为相对路径问题） */
export function kernelOf<T, Encoded>(codec: CodecLike<T, Encoded>): Kernel<T, Encoded> {
  const own = kernels.get(codec) ?? adoptedKernels.get(codec);
  if (own !== undefined) return own as Kernel<T, Encoded>;
  const adopted: Kernel<T, Encoded> = {
    decode: (input, collector) => callForeign(() => codec.decode(input), collector),
    encode: (input, collector) => callForeign(() => codec.encode(input), collector),
  };
  adoptedKernels.set(codec, adopted);
  return adopted;
}

/** 读取任意 Codec 的只读结构描述符；外部 CodecLike 视为不透明自定义节点 */
export function descriptorOf(codec: object): CodecDescriptor {
  return descriptors.get(codec) ?? OPAQUE_DESCRIPTOR;
}

function callForeign<Out>(invoke: () => Out, collector: IssueCollector): Out | Invalid {
  try {
    return invoke();
  } catch (error) {
    if (ValidationError.is(error)) {
      return collector.addRelativeIssues(error.issues);
    }
    throw error;
  }
}
