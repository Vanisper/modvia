import { isPlainObject, writeOwnField } from "../../shared/object.ts";
import { deduplicateLiterals, isPrimitiveLiteral } from "../../shared/value.ts";
import {
  acquireCollector,
  createScopedContext,
  INVALID,
  isAbortSignal,
  releaseCollector,
  releaseFailedCollector,
  type InternalCollector,
  type Invalid,
  type IssueCollector,
  type SegmentMapper,
} from "./collector.ts";
import { ValidationError } from "./errors.ts";
import type {
  Branded,
  Codec,
  CodecContext,
  CodecDescriptor,
  CodecLike,
  CodecMethodBuilders,
  CodecOrField,
  CodecTrait,
  DefaultProvider,
  Field,
  FieldLike,
  FieldLiteral,
  FieldPresence,
  SafeResult,
  StandardSchemaV1,
  StatePatch,
  ValueCodecInput,
  WithCodecTrait,
} from "./types.ts";

export type CodecDirection = "decode" | "encode";

export type InternalRunner<T, Encoded> = (
  input: unknown,
  direction: CodecDirection,
  collector: IssueCollector,
) => (T | Encoded) | Invalid;

interface RunnerCarrier<T = unknown, Encoded = unknown> {
  readonly [runnerSymbol]?: InternalRunner<T, Encoded>;
}

const runnerSymbol = Symbol.for("modvia.codecRunner");
const literalStateSymbol = Symbol.for("modvia.literalState");
const allowedLiteralsSymbol = Symbol.for("modvia.allowedLiterals");
const segmentMapperSymbol = Symbol.for("modvia.decodeSegmentMapper");
const defaultResolverSymbol = Symbol.for("modvia.defaultResolver");
const traitKeysSymbol = Symbol.for("modvia.traitKeys");
export const descriptorSymbol = Symbol.for("modvia.codecDescriptor");
export const fieldBrand = Symbol.for("modvia.Field");

const defaultCustomDescriptor: CodecDescriptor = Object.freeze({ kind: "custom" });

interface LiteralState {
  readonly base: Codec<unknown, unknown>;
  readonly literals: readonly FieldLiteral[];
}

export interface CodecMetadata {
  readonly literalState?: LiteralState;
  readonly allowedLiterals?: readonly FieldLiteral[];
  readonly decodeSegmentMapper?: SegmentMapper;
  readonly descriptor?: CodecDescriptor;
}

export function createCodec<T, Encoded>(
  runner: InternalRunner<T, Encoded>,
  metadata?: CodecMetadata,
): Codec<T, Encoded> {
  return instantiateCodec(runner, metadata);
}

function instantiateCodec<T, Encoded, Extra extends object = Record<never, never>>(
  runner: InternalRunner<T, Encoded>,
  metadata?: CodecMetadata,
  extra?: Extra,
  extraSymbols?: ReadonlyArray<readonly [symbol, unknown]>,
): Codec<T, Encoded> & Extra {
  const literalState = metadata?.literalState;
  const decodeSegmentMapper = metadata?.decodeSegmentMapper;
  const unknownRunner = runner as InternalRunner<unknown, unknown>;

  const parse = (input: unknown): T => runThrowing<T>(unknownRunner, input, "decode");
  const dump = (input: unknown): Encoded => runThrowing<Encoded>(unknownRunner, input, "encode");
  const safeParse = (input: unknown): SafeResult<T> => runSafe<T>(unknownRunner, input, "decode");
  const safeDump = (input: unknown): SafeResult<Encoded> =>
    runSafe<Encoded>(unknownRunner, input, "encode");

  const standardProps: StandardSchemaV1.Props<Encoded, T> = Object.freeze({
    version: 1,
    vendor: "modvia",
    validate(value: unknown): StandardSchemaV1.Result<T> {
      const collector = acquireCollector();
      const output = executeTopLevel(unknownRunner, value, "decode", collector);
      if (output === INVALID) {
        return { issues: releaseFailedCollector(collector) };
      }
      releaseCollector(collector);
      return { value: output as T };
    },
  });

  function refine<Narrowed extends T>(
    predicate: (value: T) => value is Narrowed,
    code: string,
    message: string,
  ): Codec<Narrowed, Encoded>;
  function refine(
    predicate: (value: T) => boolean,
    code: string,
    message: string,
  ): Codec<T, Encoded>;
  function refine(
    predicate: (value: T) => boolean,
    code: string,
    message: string,
  ): Codec<T, Encoded> {
    if (typeof predicate !== "function") {
      throw new TypeError("refine requires a predicate function");
    }
    if (typeof code !== "string" || code.length === 0) {
      throw new TypeError("refine requires a non-empty error code");
    }
    if (typeof message !== "string") {
      throw new TypeError("refine requires an error message string");
    }
    return createRefinedCodec(codec, predicate, code, message, decodeSegmentMapper);
  }

  const codec: Codec<T, Encoded> & Extra = {
    [Symbol.toStringTag]: "modvia.Codec",
    "~standard": standardProps,
    decode: parse,
    encode: dump,
    safeDecode: safeParse,
    safeEncode: safeDump,
    parse,
    safeParse,
    dump,
    safeDump,
    check(rule: (value: T, context: CodecContext) => void) {
      if (typeof rule !== "function") {
        throw new TypeError("check requires a validation function");
      }
      return createCheckedCodec(codec, rule, decodeSegmentMapper);
    },
    refine,
    normalize(fn: (value: T) => T) {
      if (typeof fn !== "function") {
        throw new TypeError("normalize requires a transformation function");
      }
      return createNormalizedCodec(codec, fn, decodeSegmentMapper);
    },
    brand<const Name extends string | symbol>() {
      return codec as unknown as Codec<Branded<T, Name>, Encoded>;
    },
    describe(description: string) {
      assertValidDescription(description);
      const baseDescriptor = getCodecDescriptor(codec);
      return createCodec(runner, {
        literalState,
        allowedLiterals: metadata?.allowedLiterals,
        decodeSegmentMapper,
        descriptor: { ...baseDescriptor, description },
      });
    },
    pipe(next: ValueCodecInput<unknown, T>) {
      return createPipedCodec(codec, next) as never;
    },
    or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(...values: Literals) {
      assertValidLiterals(values);
      return createLiteralExtendedCodec<T, Encoded, Literals>(codec, values, literalState);
    },
    nullable() {
      return createLiteralExtendedCodec<T, Encoded, readonly [null]>(codec, [null], literalState);
    },
    alias<NextSource extends string>(source: NextSource) {
      assertValidSource(source);
      return createField(codec, source, "required");
    },
    optional() {
      return createField(codec, undefined, "optional");
    },
    default(provider: DefaultProvider<T>) {
      return createField(codec, undefined, "defaulted", toDefaultResolver(provider));
    },
    ...(extra as Extra),
  };

  Object.defineProperty(codec, runnerSymbol, { value: runner });
  if (literalState) {
    Object.defineProperty(codec, literalStateSymbol, { value: literalState });
  }
  if (metadata?.allowedLiterals) {
    Object.defineProperty(codec, allowedLiteralsSymbol, {
      value: Object.freeze([...metadata.allowedLiterals]),
    });
  }
  if (decodeSegmentMapper) {
    Object.defineProperty(codec, segmentMapperSymbol, { value: decodeSegmentMapper });
  }
  if (metadata?.descriptor) {
    Object.defineProperty(codec, descriptorSymbol, { value: Object.freeze(metadata.descriptor) });
  }
  if (extraSymbols) {
    for (const [sym, value] of extraSymbols) {
      Object.defineProperty(codec, sym, { value });
    }
  }
  return Object.freeze(codec);
}

export function extendCodec<T, Encoded, Extra extends object>(
  base: Codec<T, Encoded>,
  extra: Extra,
  extraSymbols?: ReadonlyArray<readonly [symbol, unknown]>,
): Codec<T, Encoded> & Extra {
  const runner = (base as RunnerCarrier<T, Encoded>)[runnerSymbol]!;
  const literalState = Reflect.get(base, literalStateSymbol) as LiteralState | undefined;
  const allowedLiterals = Reflect.get(base, allowedLiteralsSymbol) as
    | readonly FieldLiteral[]
    | undefined;
  const decodeSegmentMapper = Reflect.get(base, segmentMapperSymbol) as SegmentMapper | undefined;
  const descriptor = Reflect.get(base, descriptorSymbol) as CodecDescriptor | undefined;
  return instantiateCodec(
    runner,
    { literalState, allowedLiterals, decodeSegmentMapper, descriptor },
    extra,
    extraSymbols,
  );
}

const reservedCodecKeys = new Set<string>([
  "~standard",
  "decode",
  "encode",
  "safeDecode",
  "safeEncode",
  "parse",
  "safeParse",
  "dump",
  "safeDump",
  "check",
  "refine",
  "normalize",
  "brand",
  "describe",
  "pipe",
  "or",
  "nullable",
  "alias",
  "optional",
  "default",
  "__proto__",
  "constructor",
]);

export interface StatefulCodecRuntimeSpec<
  T,
  Encoded,
  S extends object,
  M extends CodecMethodBuilders<S>,
> {
  readonly state: S;
  readonly description?: string;
  readonly validate?: (state: Readonly<S>) => void;
  readonly createRunner: (state: Readonly<S>) => InternalRunner<T, Encoded>;
  readonly createDescriptor: (state: Readonly<S>, description?: string) => CodecDescriptor;
  readonly methods: M;
  readonly extraMethods?: (
    state: Readonly<S>,
    description?: string,
  ) => Readonly<Record<string, (...args: never[]) => unknown>>;
}

export function createStatefulCodec<T, Encoded, S extends object, M extends CodecMethodBuilders<S>>(
  spec: StatefulCodecRuntimeSpec<T, Encoded, S, M>,
): WithCodecTrait<T, Encoded, M> {
  if (!isPlainObject(spec.methods)) {
    throw new TypeError("Codec methods must be a plain object");
  }
  const methodEntries = Object.entries(spec.methods);
  for (const [name, builder] of methodEntries) {
    if (reservedCodecKeys.has(name)) {
      throw new RangeError(
        `Cannot define custom codec method "${name}" because it conflicts with a reserved Codec member`,
      );
    }
    if (typeof builder !== "function") {
      throw new TypeError(`Codec method "${name}" must be a function`);
    }
  }
  const traitKeys = Object.freeze(methodEntries.map(([name]) => name));
  return instantiateStatefulCodec(spec, methodEntries, traitKeys);
}

function instantiateStatefulCodec<T, Encoded, S extends object, M extends CodecMethodBuilders<S>>(
  spec: StatefulCodecRuntimeSpec<T, Encoded, S, M>,
  methodEntries: ReadonlyArray<readonly [string, (...args: never[]) => StatePatch<S>]>,
  traitKeys: readonly string[],
): WithCodecTrait<T, Encoded, M> {
  if (!isPlainObject(spec.state)) {
    throw new TypeError("Codec state must be a plain object");
  }
  const frozenState = Object.freeze({ ...spec.state }) as Readonly<S>;
  spec.validate?.(frozenState);

  const runner = spec.createRunner(frozenState);
  const descriptor = spec.createDescriptor(frozenState, spec.description);

  const extra: Record<string, unknown> = {
    describe(description: string): WithCodecTrait<T, Encoded, M> {
      assertValidDescription(description);
      return instantiateStatefulCodec({ ...spec, description }, methodEntries, traitKeys);
    },
  };

  for (const [name, builder] of methodEntries) {
    writeOwnField(extra, name, (...args: never[]) => {
      const rawPatch = builder(...args);
      const resolvedPatch =
        typeof rawPatch === "function"
          ? (rawPatch as (prev: Readonly<S>) => Partial<Readonly<S>>)(frozenState)
          : rawPatch;
      if (!isPlainObject(resolvedPatch)) {
        throw new TypeError(
          `Codec method "${name}" must return a plain state patch object or (prev) => patch function`,
        );
      }
      const nextState = { ...frozenState, ...resolvedPatch } as S;
      return instantiateStatefulCodec({ ...spec, state: nextState }, methodEntries, traitKeys);
    });
  }

  if (spec.extraMethods) {
    for (const [name, fn] of Object.entries(spec.extraMethods(frozenState, spec.description))) {
      writeOwnField(extra, name, fn);
    }
  }

  return instantiateCodec(runner, { descriptor }, extra, [
    [traitKeysSymbol, traitKeys],
  ]) as unknown as WithCodecTrait<T, Encoded, M>;
}

export function getCodecDescriptor(value: CodecOrField): CodecDescriptor {
  if (isFieldDescriptor(value)) {
    const inner = getCodecDescriptor(value.codec);
    return value.description !== undefined
      ? Object.freeze({ ...inner, description: value.description })
      : inner;
  }
  if (typeof value === "object" && value !== null) {
    const descriptor = Reflect.get(value, descriptorSymbol) as CodecDescriptor | undefined;
    if (descriptor !== undefined) return descriptor;
  }
  return defaultCustomDescriptor;
}

function executeForeignCodec<T, Encoded>(
  codec: CodecLike<T, Encoded>,
  input: unknown,
  direction: CodecDirection,
  collector: IssueCollector,
): (T | Encoded) | Invalid {
  try {
    return direction === "decode" ? codec.decode(input) : codec.encode(input);
  } catch (error) {
    if (isAbortSignal(error)) {
      return collector.add(error.code, error.message);
    }
    if (ValidationError.is(error)) {
      return collector.addRelativeIssues(error.issues);
    }
    throw error;
  }
}

export function getCodecRunner<T, Encoded>(
  codec: CodecLike<T, Encoded>,
): InternalRunner<T, Encoded> {
  const direct = (codec as RunnerCarrier<T, Encoded>)[runnerSymbol];
  if (typeof direct === "function") return direct;
  return (input, direction, collector) => executeForeignCodec(codec, input, direction, collector);
}

export function promoteToCodec<T, Encoded>(codec: CodecLike<T, Encoded>): Codec<T, Encoded> {
  if (isStandardCodec(codec)) return codec;
  return createCodec<T, Encoded>(getCodecRunner(codec));
}

export function isStandardCodec<T, Encoded>(
  value: CodecLike<T, Encoded>,
): value is Codec<T, Encoded>;
export function isStandardCodec(value: unknown): value is Codec<unknown, unknown>;
export function isStandardCodec(value: unknown): value is Codec<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<Codec<unknown, unknown>>)[Symbol.toStringTag] === "modvia.Codec" &&
    typeof (value as RunnerCarrier)[runnerSymbol] === "function"
  );
}

export function isFieldDescriptor(
  value: unknown,
): value is FieldLike<unknown, unknown, string | undefined, FieldPresence> {
  if (typeof value !== "object" || value === null) return false;
  try {
    if ((value as { readonly [fieldBrand]?: unknown })[fieldBrand] === true) return true;
    const candidate = value as Partial<Field<unknown, unknown, string | undefined, FieldPresence>>;
    return (
      candidate[Symbol.toStringTag] === "modvia.Field" &&
      (candidate.presence === "required" ||
        candidate.presence === "optional" ||
        candidate.presence === "defaulted") &&
      (candidate.source === undefined || typeof candidate.source === "string") &&
      typeof candidate.codec === "object" &&
      candidate.codec !== null &&
      typeof candidate.codec.decode === "function" &&
      typeof candidate.codec.encode === "function"
    );
  } catch {
    return false;
  }
}

export function assertValueCodec(
  codec: unknown,
  caller: string,
): asserts codec is CodecLike<unknown, unknown> {
  if (isFieldDescriptor(codec)) {
    throw new TypeError(
      `${caller} accepts a value Codec, not a Field with .alias() or .optional(); apply field modifiers on the outer container or pass field.codec`,
    );
  }
  if (
    typeof codec !== "object" ||
    codec === null ||
    typeof (codec as Partial<CodecLike<unknown, unknown>>).decode !== "function" ||
    typeof (codec as Partial<CodecLike<unknown, unknown>>).encode !== "function"
  ) {
    throw new TypeError(`${caller} requires a valid Codec`);
  }
}

export function getDefaultResolver(value: unknown): (() => unknown) | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const resolver = (value as { readonly [defaultResolverSymbol]?: unknown })[defaultResolverSymbol];
  return typeof resolver === "function" ? (resolver as () => unknown) : undefined;
}

export function createField<
  T,
  Encoded,
  Source extends string | undefined,
  Presence extends FieldPresence,
>(
  codec: Codec<T, Encoded>,
  source: Source,
  presence: Presence,
  defaultResolver?: () => unknown,
  description?: string,
): Field<T, Encoded, Source, Presence> {
  const fieldDescriptor: Field<T, Encoded, Source, Presence> & {
    readonly [fieldBrand]: true;
    readonly [defaultResolverSymbol]?: () => unknown;
  } = {
    [fieldBrand]: true,
    ...(defaultResolver ? { [defaultResolverSymbol]: defaultResolver } : {}),
    [Symbol.toStringTag]: "modvia.Field",
    codec,
    source,
    presence,
    description,
    alias<NextSource extends string>(nextSource: NextSource) {
      assertValidSource(nextSource);
      return createField(codec, nextSource, presence, defaultResolver, description);
    },
    optional() {
      if (presence === "optional") {
        return fieldDescriptor as Field<T, Encoded, Source, "optional">;
      }
      return createField(codec, source, "optional", undefined, description);
    },
    required() {
      if (presence === "required") {
        return fieldDescriptor as Field<T, Encoded, Source, "required">;
      }
      return createField(codec, source, "required", undefined, description);
    },
    default(provider: DefaultProvider<T>) {
      return createField(codec, source, "defaulted", toDefaultResolver(provider), description);
    },
    or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(...values: Literals) {
      return createField(codec.or(...values), source, presence, defaultResolver, description);
    },
    nullable() {
      return createField(codec.nullable(), source, presence, defaultResolver, description);
    },
    describe(nextDescription: string) {
      assertValidDescription(nextDescription);
      return createField(codec, source, presence, defaultResolver, nextDescription);
    },
  };

  return Object.freeze(fieldDescriptor);
}

export function createPipedCodec<Mid, Encoded, Out, Trait extends CodecTrait>(
  first: ValueCodecInput<Mid, Encoded>,
  second: WithCodecTrait<Out, Mid, Trait>,
): WithCodecTrait<Out, Encoded, Trait>;
export function createPipedCodec<Mid, Encoded, Out>(
  first: ValueCodecInput<Mid, Encoded>,
  second: ValueCodecInput<Out, Mid>,
): Codec<Out, Encoded>;
export function createPipedCodec<Mid, Encoded, Out>(
  first: ValueCodecInput<Mid, Encoded>,
  second: ValueCodecInput<Out, Mid>,
): Codec<Out, Encoded> {
  assertValueCodec(first, "pipe");
  assertValueCodec(second, "pipe");

  const firstCodec = promoteToCodec(first);
  const secondCodec = promoteToCodec(second);
  return buildPipedInstance(firstCodec, secondCodec, undefined);
}

function buildPipedInstance<Mid, Encoded, Out>(
  firstCodec: Codec<Mid, Encoded>,
  secondCodec: Codec<Out, Mid>,
  description: string | undefined,
): Codec<Out, Encoded> {
  const firstMapper = Reflect.get(firstCodec, segmentMapperSymbol) as SegmentMapper | undefined;
  const secondMapper = Reflect.get(secondCodec, segmentMapperSymbol) as SegmentMapper | undefined;
  const decodeSegmentMapper: SegmentMapper | undefined =
    firstMapper && secondMapper
      ? (segment) => firstMapper(secondMapper(segment))
      : (secondMapper ?? firstMapper);

  const firstRunner = getCodecRunner(firstCodec);
  const secondRunner = getCodecRunner(secondCodec);

  const runner: InternalRunner<Out, Encoded> = (input, direction, collector) => {
    if (direction === "decode") {
      const mid = firstRunner(input, "decode", collector);
      if (mid === INVALID) return INVALID;
      return secondRunner(mid, "decode", collector) as Out | Invalid;
    }
    const mid = secondRunner(input, "encode", collector);
    if (mid === INVALID) return INVALID;
    return firstRunner(mid, "encode", collector) as Encoded | Invalid;
  };

  const metadata: CodecMetadata = {
    decodeSegmentMapper,
    descriptor: {
      kind: "pipe",
      first: firstCodec as Codec<unknown, unknown>,
      second: secondCodec as Codec<unknown, unknown>,
      ...(description !== undefined ? { description } : {}),
    },
  };

  const traitKeys = Reflect.get(secondCodec, traitKeysSymbol) as readonly string[] | undefined;
  if (!traitKeys || traitKeys.length === 0) {
    return instantiateCodec(runner, metadata);
  }

  const extra: Record<string, unknown> = {
    describe(nextDescription: string) {
      assertValidDescription(nextDescription);
      return buildPipedInstance(firstCodec, secondCodec, nextDescription);
    },
  };

  for (const methodName of traitKeys) {
    const targetMethod = Reflect.get(secondCodec, methodName) as
      | ((...args: unknown[]) => Codec<Out, Mid>)
      | undefined;
    if (typeof targetMethod === "function") {
      writeOwnField(extra, methodName, (...args: unknown[]) => {
        const nextSecond = Reflect.apply(targetMethod, undefined, args);
        return buildPipedInstance(firstCodec, nextSecond, description);
      });
    }
  }

  return instantiateCodec(runner, metadata, extra, [[traitKeysSymbol, traitKeys]]);
}

export function getStaticLiterals(
  codec: CodecLike<unknown, unknown>,
): readonly FieldLiteral[] | undefined {
  const direct = Reflect.get(codec, allowedLiteralsSymbol) as readonly FieldLiteral[] | undefined;
  if (Array.isArray(direct)) return direct;

  const state = Reflect.get(codec, literalStateSymbol) as LiteralState | undefined;
  if (!state) return undefined;
  const inner = getStaticLiterals(state.base);
  return inner ? deduplicateLiterals(state.literals, inner) : undefined;
}

function createRefinedCodec<T, Encoded>(
  base: Codec<T, Encoded>,
  predicate: (value: T) => boolean,
  code: string,
  message: string,
  decodeSegmentMapper?: SegmentMapper,
): Codec<T, Encoded> {
  const baseRunner = getCodecRunner(base);
  return createCodec<T, Encoded>(
    (input, direction, collector) => {
      const converted = baseRunner(input, direction, collector);
      if (converted === INVALID) return INVALID;
      const domainValue = (direction === "decode" ? converted : input) as T;
      return predicate(domainValue) ? converted : collector.add(code, message);
    },
    { decodeSegmentMapper, descriptor: getCodecDescriptor(base) },
  );
}

function createCheckedCodec<T, Encoded>(
  base: Codec<T, Encoded>,
  rule: (value: T, context: CodecContext) => void,
  decodeSegmentMapper?: SegmentMapper,
): Codec<T, Encoded> {
  const baseRunner = getCodecRunner(base);
  return createCodec<T, Encoded>(
    (input, direction, collector) => {
      const converted = baseRunner(input, direction, collector);
      if (converted === INVALID) return INVALID;

      const domainValue = (direction === "decode" ? converted : input) as T;
      const mark = collector.mark();
      const context = createScopedContext(
        collector,
        direction === "decode" ? decodeSegmentMapper : undefined,
      );
      try {
        rule(domainValue, context);
        return collector.mark() > mark ? INVALID : converted;
      } catch (error) {
        if (isAbortSignal(error)) {
          return collector.add(error.code, error.message);
        }
        if (ValidationError.is(error)) {
          return collector.addRelativeIssues(error.issues);
        }
        throw error;
      }
    },
    { decodeSegmentMapper, descriptor: getCodecDescriptor(base) },
  );
}

function createNormalizedCodec<T, Encoded>(
  base: Codec<T, Encoded>,
  fn: (value: T) => T,
  decodeSegmentMapper?: SegmentMapper,
): Codec<T, Encoded> {
  const baseRunner = getCodecRunner(base);
  return createCodec<T, Encoded>(
    (input, direction, collector) => {
      if (direction === "decode") {
        const decoded = baseRunner(input, "decode", collector);
        return decoded === INVALID ? INVALID : fn(decoded as T);
      }

      const firstPass = baseRunner(input, "encode", collector);
      if (firstPass === INVALID) return INVALID;
      const normalized = fn(input as T);
      if (Object.is(normalized, input)) return firstPass;
      return baseRunner(normalized, "encode", collector);
    },
    { decodeSegmentMapper, descriptor: getCodecDescriptor(base) },
  );
}

function executeTopLevel(
  runner: InternalRunner<unknown, unknown>,
  input: unknown,
  direction: CodecDirection,
  collector: InternalCollector,
): unknown {
  try {
    return runner(input, direction, collector);
  } catch (error) {
    releaseCollector(collector);
    throw error;
  }
}

function runThrowing<Result>(
  runner: InternalRunner<unknown, unknown>,
  input: unknown,
  direction: CodecDirection,
): Result {
  const collector = acquireCollector();
  const output = executeTopLevel(runner, input, direction, collector);
  if (output === INVALID) {
    throw new ValidationError(releaseFailedCollector(collector));
  }
  releaseCollector(collector);
  return output as Result;
}

function runSafe<Result>(
  runner: InternalRunner<unknown, unknown>,
  input: unknown,
  direction: CodecDirection,
): SafeResult<Result> {
  const collector = acquireCollector();
  const output = executeTopLevel(runner, input, direction, collector);
  if (output === INVALID) {
    return Object.freeze({ ok: false, issues: releaseFailedCollector(collector) });
  }
  releaseCollector(collector);
  return Object.freeze({ ok: true, value: output as Result });
}

function createLiteralExtendedCodec<
  T,
  Encoded,
  const Literals extends readonly [FieldLiteral, ...FieldLiteral[]],
>(
  current: Codec<T, Encoded>,
  addedLiterals: Literals,
  existingState?: LiteralState,
): Codec<T | Literals[number], Encoded | Literals[number]> {
  const base = (existingState?.base ?? current) as Codec<T, Encoded>;
  const baseRunner = getCodecRunner(base);
  const existingDescription = existingState ? getCodecDescriptor(current).description : undefined;
  const mergedLiterals = deduplicateLiterals(existingState?.literals ?? [], addedLiterals);
  const literalState: LiteralState = {
    base: base as Codec<unknown, unknown>,
    literals: mergedLiterals,
  };

  let runner: InternalRunner<T | Literals[number], Encoded | Literals[number]>;
  if (mergedLiterals.length === 1) {
    const single = mergedLiterals[0] as Literals[number];
    runner = (input, direction, collector) =>
      Object.is(input, single) ? single : baseRunner(input, direction, collector);
  } else {
    const candidates = [...mergedLiterals];
    runner = (input, direction, collector) => {
      for (const literal of candidates) {
        if (Object.is(input, literal)) return literal as Literals[number];
      }
      return baseRunner(input, direction, collector);
    };
  }

  return createCodec<T | Literals[number], Encoded | Literals[number]>(runner, {
    literalState,
    descriptor: {
      kind: "or",
      base: literalState.base,
      literals: mergedLiterals,
      ...(existingDescription !== undefined ? { description: existingDescription } : {}),
    },
  });
}

function toDefaultResolver<T>(provider: unknown): () => T {
  if (typeof provider === "function") {
    return provider as () => T;
  }
  if (isPrimitiveLiteral(provider)) {
    return () => provider as T;
  }
  throw new TypeError(
    "Non-primitive default values must be provided via a factory function () => value",
  );
}

function assertValidDescription(description: unknown): asserts description is string {
  if (typeof description !== "string") {
    throw new TypeError("Description must be a string");
  }
}

function assertValidSource(source: unknown): asserts source is string {
  if (typeof source !== "string") {
    throw new TypeError("Field source must be a string");
  }
}

function assertValidLiterals(
  values: readonly unknown[],
): asserts values is readonly FieldLiteral[] {
  if (values.length === 0 || !values.every(isPrimitiveLiteral)) {
    throw new TypeError(
      "or requires at least one string, number, boolean, null, or undefined literal",
    );
  }
}
