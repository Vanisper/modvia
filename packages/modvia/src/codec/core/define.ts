import {
  createPrimaryContext,
  createPrimaryStatefulContext,
  createScopedContext,
  createStatefulScopedContext,
  enterActiveContext,
  INVALID,
  isAbortSignal,
  leaveActiveContext,
  primaryCollector,
} from "./collector.ts";
import { ValidationError } from "./errors.ts";
import {
  createCodec,
  createField,
  createStatefulCodec,
  getCodecDescriptor,
  getDefaultResolver,
  isFieldDescriptor,
  isStandardCodec,
  promoteToCodec,
  type InternalRunner,
} from "./runtime.ts";
import type {
  Codec,
  CodecContext,
  CodecDescriptor,
  CodecLike,
  CodecMethodBuilders,
  CodecOrField,
  CustomCodecMeta,
  DisallowReservedCodecKeys,
  Field,
  FieldLike,
  FieldPresence,
  StatefulCodecContext,
  WithCodecTrait,
} from "./types.ts";

export interface CodecHandlers<T, Encoded> {
  decode(this: void, input: unknown, context: CodecContext): T;
  encode(this: void, input: unknown, context: CodecContext): Encoded;
  readonly meta?: CustomCodecMeta;
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
  decode(this: void, input: unknown, context: StatefulCodecContext<NoInfer<S>>): T;
  /** 基于 context.state 只读状态将业务值编码为外部表示 */
  encode(this: void, input: unknown, context: StatefulCodecContext<NoInfer<S>>): Encoded;
  /** 静态或随状态动态计算的只读结构元数据，供 Schema 导出工具读取 */
  readonly meta?: CustomCodecMeta | ((this: void, state: Readonly<NoInfer<S>>) => CustomCodecMeta);
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
export function defineCodec<T, Encoded = T>(
  handlers:
    | CodecHandlers<T, Encoded>
    | StatefulCodecHandlers<T, Encoded, object, CodecMethodBuilders<object>>,
): Codec<T, Encoded> {
  if (typeof handlers !== "object" || handlers === null) {
    throw new TypeError("Codec.define requires a handlers object");
  }
  if (typeof handlers.decode !== "function" || typeof handlers.encode !== "function") {
    throw new TypeError("Codec.define requires decode and encode functions");
  }

  if ("state" in handlers || "methods" in handlers) {
    const stateful = handlers as StatefulCodecHandlers<
      T,
      Encoded,
      object,
      CodecMethodBuilders<object>
    >;
    if (stateful.validate !== undefined && typeof stateful.validate !== "function") {
      throw new TypeError("Codec.define validate must be a function");
    }
    return createStatefulCodec({
      state: stateful.state,
      validate: stateful.validate,
      createRunner: (state) => buildStatefulHandlerRunner(state, stateful.decode, stateful.encode),
      createDescriptor: (state, explicitDescription) => {
        const resolvedMeta =
          typeof stateful.meta === "function" ? stateful.meta(state) : stateful.meta;
        return buildCustomDescriptor(resolvedMeta, explicitDescription);
      },
      methods: stateful.methods,
    });
  }

  return createCodec<T, Encoded>(buildHandlerRunner(handlers.decode, handlers.encode), {
    descriptor: buildCustomDescriptor(handlers.meta),
  });
}

function buildCustomDescriptor(
  meta?: CustomCodecMeta,
  explicitDescription?: string,
): CodecDescriptor {
  const description = explicitDescription ?? meta?.description;
  return {
    kind: "custom",
    ...(meta?.format !== undefined ? { format: meta.format } : {}),
    ...(description !== undefined ? { description } : {}),
    ...(meta?.encodedSchema !== undefined ? { encodedSchema: meta.encodedSchema } : {}),
    ...(meta?.decodedSchema !== undefined ? { decodedSchema: meta.decodedSchema } : {}),
  };
}

function buildHandlerRunner<T, Encoded>(
  decodeFn: (input: unknown, context: CodecContext) => T,
  encodeFn: (input: unknown, context: CodecContext) => Encoded,
): InternalRunner<T, Encoded> {
  const primaryContext = createPrimaryContext();

  return (input, direction, collector) => {
    const mark = collector.mark();
    const context =
      collector === primaryCollector ? primaryContext : createScopedContext(collector);
    const prevToken = enterActiveContext(context);
    try {
      const output = direction === "decode" ? decodeFn(input, context) : encodeFn(input, context);
      return collector.mark() > mark ? INVALID : output;
    } catch (error) {
      if (isAbortSignal(error)) {
        return collector.add(error.code, error.message);
      }
      if (ValidationError.is(error)) {
        return collector.addRelativeIssues(error.issues);
      }
      throw error;
    } finally {
      leaveActiveContext(prevToken);
    }
  };
}

function buildStatefulHandlerRunner<T, Encoded, S extends object>(
  state: Readonly<S>,
  decodeFn: (input: unknown, context: StatefulCodecContext<S>) => T,
  encodeFn: (input: unknown, context: StatefulCodecContext<S>) => Encoded,
): InternalRunner<T, Encoded> {
  const primaryStatefulContext = createPrimaryStatefulContext(state);

  return (input, direction, collector) => {
    const mark = collector.mark();
    const statefulContext =
      collector === primaryCollector
        ? primaryStatefulContext
        : createStatefulScopedContext(collector, state);
    const prevToken = enterActiveContext(statefulContext);
    try {
      const output =
        direction === "decode"
          ? decodeFn(input, statefulContext)
          : encodeFn(input, statefulContext);
      return collector.mark() > mark ? INVALID : output;
    } catch (error) {
      if (isAbortSignal(error)) {
        return collector.add(error.code, error.message);
      }
      if (ValidationError.is(error)) {
        return collector.addRelativeIssues(error.issues);
      }
      throw error;
    } finally {
      leaveActiveContext(prevToken);
    }
  };
}

/** 读取任意 Codec、Field、Model 或自定义 CodecLike 的只读结构描述符（Field 自动叠加槽位级 description） */
export function inspectCodec(codec: CodecOrField): CodecDescriptor {
  if (isFieldDescriptor(codec)) {
    return getCodecDescriptor(codec);
  }
  if (
    typeof codec !== "object" ||
    codec === null ||
    typeof codec.decode !== "function" ||
    typeof codec.encode !== "function"
  ) {
    throw new TypeError("inspectCodec requires a valid Codec, Field, or CodecLike object");
  }
  return getCodecDescriptor(codec);
}

/** 包装已有字段并保留外部键名、缺省性与属性说明 */
export function field<
  T,
  Encoded,
  Source extends string | undefined,
  Presence extends FieldPresence = "required",
>(input: FieldLike<T, Encoded, Source, Presence>): Field<T, Encoded, Source, Presence>;
/** 将任意 Codec 或自定义 CodecLike 转为字段描述符 */
export function field<T, Encoded>(input: CodecLike<T, Encoded>): Field<T, Encoded>;
export function field<T, Encoded>(
  input: CodecOrField<T, Encoded>,
): Field<T, Encoded, string | undefined, FieldPresence> {
  if (!isField(input)) {
    if (
      typeof input !== "object" ||
      input === null ||
      typeof input.decode !== "function" ||
      typeof input.encode !== "function"
    ) {
      throw new TypeError("Field.of requires a valid Codec, Field, or CodecLike object");
    }
    return createField(promoteToCodec(input), undefined, "required");
  }
  const { source, presence, description } = input;
  const inner = isStandardCodec(input.codec) ? input.codec : promoteToCodec(input.codec);
  const normalizedPresence: FieldPresence =
    presence === "optional" ? "optional" : presence === "defaulted" ? "defaulted" : "required";
  return createField(
    inner,
    typeof source === "string" ? source : undefined,
    normalizedPresence,
    normalizedPresence === "defaulted" ? getDefaultResolver(input) : undefined,
    typeof description === "string" ? description : undefined,
  );
}

/** 判断目标值是否为带外部键名与缺省性元数据的 Field 描述符 */
export function isField<T, Encoded>(
  value: CodecOrField<T, Encoded>,
): value is FieldLike<T, Encoded, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is FieldLike<unknown, unknown, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is FieldLike<unknown, unknown, string | undefined, FieldPresence> {
  return isFieldDescriptor(value);
}
