import { isPlainObject } from "../../shared/object.ts";
import {
  CodecImpl,
  prependUpstream,
  rebuildWithDescription,
  rebuildWithStandard,
  reservedCodecKeys,
  type StandardExtension,
} from "./codec.ts";
import { handlerKernel } from "./context.ts";
import { descriptorOf, kernelOf } from "./internals.ts";
import { pipeKernel } from "./kernel.ts";
import type { CodecDescriptor, DecodeContext, EncodeContext, StatePatch } from "./types.ts";

type PatchBuilder<S extends object> = (...args: never[]) => StatePatch<S>;
type Derivation = (self: CodecImpl) => CodecImpl;

/** 带自有链式方法的 Codec 族定义：状态补丁方法保持 T 与 Encoded 不变，派生方法仅存在于根实例 */
export interface FamilyDefinition<S extends object> {
  readonly state: S;
  readonly validate?: ((state: Readonly<S>) => void) | undefined;
  readonly decode: (input: unknown, context: DecodeContext<S>) => unknown;
  readonly encode: (input: unknown, context: EncodeContext<S>) => unknown;
  readonly descriptor?: CodecDescriptor | ((state: Readonly<S>) => CodecDescriptor) | undefined;
  readonly methods?: Readonly<Record<string, PatchBuilder<S>>> | undefined;
  /** 内部派生栏：返回另一个 Codec 的根实例专属方法（如 .fromString()），不进入公开 Codec.define */
  readonly derive?: Readonly<Record<string, Derivation>> | undefined;
}

/** 族原型方法调用的状态补丁钩子（模块私有符号，避免与自定义方法名冲突） */
const applyPatch = Symbol("modvia.applyPatch");

/** 族实例的完整不可变状态：with(patch) 即合并后重新实例化 */
interface TraitSpec<S extends object> {
  readonly state: Readonly<S>;
  readonly upstream?: CodecImpl | undefined;
  readonly description?: string | undefined;
  /** Standard Schema 扩展属性：只属于当前实例，任何派生都不继承 */
  readonly standard?: StandardExtension | undefined;
}

interface FamilyRuntime<S extends object> {
  readonly definition: FamilyDefinition<S>;
  /** 按冻结状态记忆的无上游、无说明核心实例（作为上游管道描述符的 second 节点，保证同一状态引用同一节点） */
  core(state: Readonly<S>): TraitCodec<S>;
  instantiate(spec: TraitSpec<S>): TraitCodec<S>;
}

/**
 * 带自有链式方法的 Codec 族基类
 *
 * @description 实例 = 可选上游 ∘ 由状态决定的核心内核；补丁方法、describe 与上游接入都只改写 spec 并重新实例化，
 * 因此任意顺序的同阶调用都收敛到同一份 spec
 */
export class TraitCodec<S extends object> extends CodecImpl {
  readonly #runtime: FamilyRuntime<S>;
  readonly #spec: TraitSpec<S>;

  constructor(runtime: FamilyRuntime<S>, spec: TraitSpec<S>) {
    const { definition } = runtime;
    const coreKernel = handlerKernel(definition.decode, definition.encode, spec.state);
    const coreDescriptor = resolveDescriptor(definition.descriptor, spec.state);
    if (spec.upstream === undefined) {
      super(coreKernel, withDescription(coreDescriptor, spec.description), spec.standard);
    } else {
      super(
        pipeKernel(kernelOf(spec.upstream), coreKernel),
        {
          kind: "pipe",
          first: spec.upstream as never,
          second: runtime.core(spec.state) as never,
          ...(spec.description !== undefined ? { description: spec.description } : {}),
        },
        spec.standard,
      );
    }
    this.#runtime = runtime;
    this.#spec = spec;
  }

  /** 以状态补丁派生同族实例（保留上游与说明） */
  [applyPatch](patch: StatePatch<S>, methodName: string): TraitCodec<S> {
    const resolved = typeof patch === "function" ? patch(this.#spec.state) : patch;
    if (!isPlainObject(resolved)) {
      throw new TypeError(
        `Codec method "${methodName}" must return a plain state patch object or (prev) => patch function`,
      );
    }
    return this.#runtime.instantiate({
      ...this.#derivable(),
      state: freezeState({ ...this.#spec.state, ...resolved }, this.#runtime.definition),
    });
  }

  override [rebuildWithDescription](description: string): TraitCodec<S> {
    return this.#runtime.instantiate({ ...this.#derivable(), description });
  }

  override [rebuildWithStandard](standard: StandardExtension): TraitCodec<S> {
    return this.#runtime.instantiate({ ...this.#spec, standard });
  }

  /** 派生新定义时沿用的 spec：Standard Schema 扩展只属于当前实例，不随派生传播 */
  #derivable(): TraitSpec<S> {
    const { standard: _instanceOnly, ...spec } = this.#spec;
    return spec;
  }

  override [prependUpstream](upstream: CodecImpl): TraitCodec<S> {
    const existing = this.#spec.upstream;
    return this.#runtime.instantiate({
      ...this.#derivable(),
      upstream: existing === undefined ? upstream : upstream.pipe(existing),
    });
  }
}

/**
 * 创建 Codec 族：补丁方法装在族原型上，派生方法装在根原型上（仅无上游的实例使用根原型）
 *
 * @returns 以给定初始状态（缺省为定义中的 state）构造族根实例的工厂
 */
export function createFamily<S extends object>(
  definition: FamilyDefinition<S>,
): (state?: S) => TraitCodec<S> {
  const methods = Object.entries(definition.methods ?? {});
  const derivations = Object.entries(definition.derive ?? {});
  for (const [name, member] of [...methods, ...derivations]) {
    if (reservedCodecKeys.has(name) || name === "constructor") {
      throw new RangeError(
        `Cannot define custom codec method "${name}" because it conflicts with a reserved Codec member`,
      );
    }
    if (typeof member !== "function") {
      throw new TypeError(`Codec method "${name}" must be a function`);
    }
  }

  class FamilyCodec extends TraitCodec<S> {}
  for (const [name, builder] of methods) {
    Object.defineProperty(FamilyCodec.prototype, name, {
      value(this: TraitCodec<S>, ...args: never[]) {
        return this[applyPatch](builder(...args), name);
      },
    });
  }
  Object.freeze(FamilyCodec.prototype);

  let RootCodec: typeof FamilyCodec = FamilyCodec;
  if (derivations.length > 0) {
    RootCodec = class RootFamilyCodec extends FamilyCodec {};
    for (const [name, derive] of derivations) {
      Object.defineProperty(RootCodec.prototype, name, {
        value(this: TraitCodec<S>) {
          if (!(this instanceof RootCodec)) {
            throw new TypeError(`Cannot invoke "${name}" on a codec with an upstream pipe`);
          }
          return inheritDescription(this, derive(this));
        },
      });
    }
    Object.freeze(RootCodec.prototype);
  }

  const cores = new WeakMap<object, TraitCodec<S>>();
  const runtime: FamilyRuntime<S> = {
    definition,
    core(state) {
      let core = cores.get(state);
      if (core === undefined) {
        core = runtime.instantiate({ state });
        cores.set(state, core);
      }
      return core;
    },
    instantiate(spec) {
      const Ctor = spec.upstream === undefined ? RootCodec : FamilyCodec;
      const instance = new Ctor(runtime, spec);
      Object.freeze(instance);
      return instance;
    },
  };

  return (state = definition.state) =>
    runtime.instantiate({ state: freezeState(state, definition) });
}

/** 校验并冻结新状态：要求普通对象，执行族定义的状态不变量守卫 */
function freezeState<S extends object>(state: S, definition: FamilyDefinition<S>): Readonly<S> {
  if (!isPlainObject(state)) {
    throw new TypeError("Codec state must be a plain object");
  }
  const frozen = Object.freeze({ ...state });
  definition.validate?.(frozen);
  return frozen;
}

function resolveDescriptor<S extends object>(
  descriptor: FamilyDefinition<S>["descriptor"],
  state: Readonly<S>,
): CodecDescriptor {
  const resolved = typeof descriptor === "function" ? descriptor(state) : descriptor;
  return resolved ?? { kind: "custom" };
}

function withDescription(
  descriptor: CodecDescriptor,
  description: string | undefined,
): CodecDescriptor {
  return description === undefined ? descriptor : { ...descriptor, description };
}

/** 派生结果继承调用者的外层说明（结果自身已声明说明时以结果为准） */
function inheritDescription(self: CodecImpl, derived: CodecImpl): CodecImpl {
  const inherited = descriptorOf(self).description;
  if (inherited === undefined || descriptorOf(derived).description !== undefined) return derived;
  return derived.describe(inherited);
}
