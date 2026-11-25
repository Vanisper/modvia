import { isPlainObject } from "../../shared/object.ts";
import { createCodec } from "./codec.ts";
import { handlerKernel } from "./context.ts";
import { createFamily } from "./trait.ts";
import type {
  Codec,
  CodecDescriptor,
  CodecMethodBuilders,
  DecodeContext,
  DisallowReservedCodecKeys,
  EncodeContext,
  Failed,
  WithCodecTrait,
} from "./types.ts";

const EMPTY_STATE: Readonly<Record<never, never>> = Object.freeze({});

export interface CodecHandlers<T, Encoded> {
  /** 校验 unknown 外部输入并解码为业务值（可直接返回 context.run 产生的 Failed 以退出失败路径） */
  decode(this: void, input: unknown, context: DecodeContext): T | Failed;
  /** 校验 unknown 候选业务值并编码为外部表示（可直接返回 context.run 产生的 Failed 以退出失败路径） */
  encode(this: void, input: unknown, context: EncodeContext): Encoded | Failed;
  /** 只读结构描述符（缺省为不透明 custom 节点），供 Schema 导出等反射工具读取 */
  readonly descriptor?: CodecDescriptor;
}

export interface StatefulCodecHandlers<
  T,
  Encoded,
  S extends object,
  M extends CodecMethodBuilders<NoInfer<S>>,
> {
  /** 初始状态对象（每次派生均由内核浅合并增量补丁并自动冻结） */
  readonly state: S;
  /** 可选的状态不变量校验器，在初始构造与每次自有方法派生时同步执行 */
  validate?(this: void, state: Readonly<NoInfer<S>>): void;
  /** 基于 context.state 只读状态将外部输入解码为业务值 */
  decode(this: void, input: unknown, context: DecodeContext<NoInfer<S>>): T | Failed;
  /** 基于 context.state 只读状态将业务值编码为外部表示 */
  encode(this: void, input: unknown, context: EncodeContext<NoInfer<S>>): Encoded | Failed;
  /** 静态或随状态动态计算的只读结构描述符 */
  readonly descriptor?:
    | CodecDescriptor
    | ((this: void, state: Readonly<NoInfer<S>>) => CodecDescriptor);
  /** 自有链式方法定义表：参数即对外方法签名，返回局部状态补丁或 (prev) => patch 函数 */
  readonly methods: M & DisallowReservedCodecKeys<M>;
}

/** 通过不可变状态与增量补丁方法定义可渐进派生的自定义双向编解码器 */
export function defineCodec<
  T,
  Encoded,
  S extends object,
  const M extends CodecMethodBuilders<NoInfer<S>>,
>(handlers: StatefulCodecHandlers<T, Encoded, S, M>): WithCodecTrait<T, Encoded, M>;
/** 通过一对双向转换函数创建标准 Codec，正反两端均须对 unknown 输入做校验并可通过 context 报告问题 */
export function defineCodec<T, Encoded = T>(handlers: CodecHandlers<T, Encoded>): Codec<T, Encoded>;
export function defineCodec(
  handlers:
    | CodecHandlers<unknown, unknown>
    | StatefulCodecHandlers<unknown, unknown, object, CodecMethodBuilders<object>>,
): Codec<unknown, unknown> {
  if (typeof handlers !== "object" || handlers === null) {
    throw new TypeError("Codec.define requires a handlers object");
  }
  if (typeof handlers.decode !== "function" || typeof handlers.encode !== "function") {
    throw new TypeError("Codec.define requires decode and encode functions");
  }

  if ("state" in handlers || "methods" in handlers) {
    const stateful = handlers as Partial<
      StatefulCodecHandlers<unknown, unknown, object, CodecMethodBuilders<object>>
    >;
    if (stateful.validate !== undefined && typeof stateful.validate !== "function") {
      throw new TypeError("Codec.define validate must be a function");
    }
    if (!isPlainObject(stateful.methods)) {
      throw new TypeError("Codec methods must be a plain object");
    }
    assertDescriptorOption(stateful.descriptor, true);
    const create = createFamily({
      state: stateful.state as object,
      validate: stateful.validate,
      decode: handlers.decode,
      encode: handlers.encode,
      descriptor: stateful.descriptor,
      methods: stateful.methods,
    });
    return create() as unknown as Codec<unknown, unknown>;
  }

  assertDescriptorOption(handlers.descriptor, false);
  return createCodec(
    handlerKernel(handlers.decode, handlers.encode, EMPTY_STATE),
    handlers.descriptor ?? { kind: "custom" },
  );
}

function assertDescriptorOption(descriptor: unknown, allowFunction: boolean): void {
  if (descriptor === undefined || (allowFunction && typeof descriptor === "function")) return;
  if (
    typeof descriptor !== "object" ||
    descriptor === null ||
    typeof (descriptor as { readonly kind?: unknown }).kind !== "string"
  ) {
    throw new TypeError(
      allowFunction
        ? "Codec.define descriptor must be a CodecDescriptor or (state) => descriptor"
        : "Codec.define descriptor must be a CodecDescriptor object",
    );
  }
}
