import { deduplicateLiterals, isPrimitiveLiteral } from "../../shared/value.ts";
import {
  createCollector,
  createScopedContext,
  INVALID,
  isAbortSignal,
  type Invalid,
  type IssueCollector,
  type SegmentMapper,
} from "./collector.ts";
import { isValidationError, ValidationError } from "./errors.ts";
import type {
  Branded,
  Codec,
  CodecContext,
  CodecDescriptor,
  CodecLike,
  DefaultProvider,
  Field,
  FieldLiteral,
  FieldPresence,
  SafeResult,
  StandardSchemaV1,
  ValueCodecInput,
} from "./types.ts";

export type CodecDirection = "decode" | "encode";

export type InternalRunner<T, Encoded> = (
  input: unknown,
  direction: CodecDirection,
  collector: IssueCollector,
) => (T | Encoded) | Invalid;

const runnerSymbol = Symbol.for("modvia.codecRunner");
const literalStateSymbol = Symbol.for("modvia.literalState");
const allowedLiteralsSymbol = Symbol.for("modvia.allowedLiterals");
const segmentMapperSymbol = Symbol.for("modvia.decodeSegmentMapper");
const defaultResolverSymbol = Symbol.for("modvia.defaultResolver");
const descriptorSymbol = Symbol.for("modvia.codecDescriptor");
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
  runner: (
    input: unknown,
    direction: CodecDirection,
    collector: IssueCollector,
  ) => (T | Encoded) | Invalid,
  metadata?: CodecMetadata,
): Codec<T, Encoded> {
  const literalState = metadata?.literalState;
  const decodeSegmentMapper = metadata?.decodeSegmentMapper;
  const safeParse = (input: unknown): SafeResult<T> => runSafe<T>(runner, input, "decode");
  const safeDump = (input: unknown): SafeResult<Encoded> =>
    runSafe<Encoded>(runner, input, "encode");

  const parse = (input: unknown): T => {
    const result = safeParse(input);
    if (!result.ok) throw new ValidationError(result.issues);
    return result.value;
  };

  const dump = (input: unknown): Encoded => {
    const result = safeDump(input);
    if (!result.ok) throw new ValidationError(result.issues);
    return result.value;
  };

  const standardProps: StandardSchemaV1.Props<Encoded, T> = Object.freeze({
    version: 1,
    vendor: "modvia",
    validate(value: unknown): StandardSchemaV1.Result<T> {
      const result = safeParse(value);
      return result.ok ? { value: result.value } : { issues: result.issues };
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
    return createCheckedCodec(
      codec,
      (value, context) => {
        if (!predicate(value)) context.fail(code, message);
      },
      decodeSegmentMapper,
    );
  }

  const codec: Codec<T, Encoded> = {
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
    pipe<Next>(next: ValueCodecInput<Next, T>) {
      return createPipedCodec(codec, next);
    },
    or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(...values: Literals) {
      assertValidLiterals(values);
      return createLiteralExtendedCodec<T, Encoded, Literals>(codec, values, literalState);
    },
    nullable() {
      return codec.or(null);
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
  return Object.freeze(codec);
}

export function extendCodec<T, Encoded, Extra extends object>(
  base: Codec<T, Encoded>,
  extra: Extra,
  extraSymbols?: ReadonlyArray<readonly [symbol, unknown]>,
): Codec<T, Encoded> & Extra {
  const runner = Reflect.get(base, runnerSymbol) as InternalRunner<T, Encoded> | undefined;
  const segmentMapper = Reflect.get(base, segmentMapperSymbol) as SegmentMapper | undefined;
  const descriptor = Reflect.get(base, descriptorSymbol) as CodecDescriptor | undefined;
  const extended = {
    ...base,
    ...extra,
  };
  if (runner) {
    Object.defineProperty(extended, runnerSymbol, { value: runner });
  }
  if (segmentMapper) {
    Object.defineProperty(extended, segmentMapperSymbol, { value: segmentMapper });
  }
  if (descriptor) {
    Object.defineProperty(extended, descriptorSymbol, { value: descriptor });
  }
  if (extraSymbols) {
    for (const [sym, value] of extraSymbols) {
      Object.defineProperty(extended, sym, { value });
    }
  }
  return Object.freeze(extended);
}

export function getCodecDescriptor(value: CodecLike<unknown, unknown>): CodecDescriptor {
  if (isFieldDescriptor(value)) {
    return getCodecDescriptor(value.codec);
  }
  if (typeof value === "object" && value !== null) {
    const descriptor = Reflect.get(value, descriptorSymbol) as CodecDescriptor | undefined;
    if (descriptor !== undefined) return descriptor;
  }
  return defaultCustomDescriptor;
}

export function executeCodec<T, Encoded>(
  codec: CodecLike<T, Encoded>,
  input: unknown,
  direction: "decode",
  collector: IssueCollector,
): T | Invalid;
export function executeCodec<T, Encoded>(
  codec: CodecLike<T, Encoded>,
  input: unknown,
  direction: "encode",
  collector: IssueCollector,
): Encoded | Invalid;
export function executeCodec<T, Encoded>(
  codec: CodecLike<T, Encoded>,
  input: unknown,
  direction: CodecDirection,
  collector: IssueCollector,
): (T | Encoded) | Invalid;
export function executeCodec<T, Encoded>(
  codec: CodecLike<T, Encoded>,
  input: unknown,
  direction: CodecDirection,
  collector: IssueCollector,
): (T | Encoded) | Invalid {
  const runner = Reflect.get(codec, runnerSymbol) as InternalRunner<T, Encoded> | undefined;
  if (typeof runner === "function") {
    return runner(input, direction, collector);
  }
  try {
    return direction === "decode" ? codec.decode(input) : codec.encode(input);
  } catch (error) {
    if (isAbortSignal(error)) {
      return collector.add(error.code, error.message);
    }
    if (isValidationError(error)) {
      return collector.addRelativeIssues(error.issues);
    }
    throw error;
  }
}

export function promoteToCodec<T, Encoded>(codec: CodecLike<T, Encoded>): Codec<T, Encoded> {
  if (isStandardCodec(codec)) return codec;
  return createCodec<T, Encoded>((input, direction, collector) =>
    executeCodec(codec, input, direction, collector),
  );
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
    typeof Reflect.get(value, runnerSymbol) === "function"
  );
}

export function isFieldDescriptor(
  value: unknown,
): value is Field<unknown, unknown, string | undefined, FieldPresence> {
  if (typeof value !== "object" || value === null) return false;
  try {
    if (Reflect.get(value, fieldBrand) === true) return true;
    const candidate = value as Partial<Field<unknown, unknown, string | undefined, FieldPresence>>;
    return (
      candidate[Symbol.toStringTag] === "modvia.Field" &&
      (candidate.presence === "required" ||
        candidate.presence === "optional" ||
        candidate.presence === "defaulted") &&
      (candidate.source === undefined || typeof candidate.source === "string") &&
      typeof candidate.decode === "function" &&
      typeof candidate.encode === "function" &&
      typeof candidate.alias === "function" &&
      typeof candidate.optional === "function" &&
      typeof candidate.or === "function"
    );
  } catch {
    return false;
  }
}

export function assertValueCodec<T, Encoded>(codec: CodecLike<T, Encoded>, caller: string): void {
  if (
    typeof codec !== "object" ||
    codec === null ||
    typeof codec.decode !== "function" ||
    typeof codec.encode !== "function"
  ) {
    throw new TypeError(`${caller} requires a valid Codec`);
  }
  if (isFieldDescriptor(codec)) {
    throw new TypeError(
      `${caller} accepts a value Codec, not a Field with .alias() or .optional(); apply field modifiers on the outer container or pass field.codec`,
    );
  }
}

export function getDefaultResolver(value: unknown): (() => unknown) | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  const resolver = Reflect.get(value, defaultResolverSymbol);
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
): Field<T, Encoded, Source, Presence> {
  const runner = Reflect.get(codec, runnerSymbol) as InternalRunner<T, Encoded> | undefined;

  const fieldDescriptor: Field<T, Encoded, Source, Presence> & {
    readonly [fieldBrand]: true;
    readonly [defaultResolverSymbol]?: () => unknown;
  } = {
    [fieldBrand]: true,
    ...(defaultResolver ? { [defaultResolverSymbol]: defaultResolver } : {}),
    [Symbol.toStringTag]: "modvia.Field",
    "~standard": codec["~standard"],
    codec,
    source,
    presence,
    decode: codec.decode,
    encode: codec.encode,
    safeDecode: codec.safeDecode,
    safeEncode: codec.safeEncode,
    parse: codec.parse,
    safeParse: codec.safeParse,
    dump: codec.dump,
    safeDump: codec.safeDump,
    alias<NextSource extends string>(nextSource: NextSource) {
      assertValidSource(nextSource);
      return createField(codec, nextSource, presence, defaultResolver);
    },
    optional() {
      if (presence === "optional") {
        return fieldDescriptor as Field<T, Encoded, Source, "optional">;
      }
      return createField(codec, source, "optional");
    },
    required() {
      if (presence === "required") {
        return fieldDescriptor as Field<T, Encoded, Source, "required">;
      }
      return createField(codec, source, "required");
    },
    default(provider: DefaultProvider<T>) {
      return createField(codec, source, "defaulted", toDefaultResolver(provider));
    },
    or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(...values: Literals) {
      return createField(codec.or(...values), source, presence, defaultResolver);
    },
    nullable() {
      return createField(codec.nullable(), source, presence, defaultResolver);
    },
  };

  if (runner) {
    Object.defineProperty(fieldDescriptor, runnerSymbol, { value: runner });
  }
  return Object.freeze(fieldDescriptor);
}

export function createPipedCodec<Mid, Encoded, Out>(
  first: ValueCodecInput<Mid, Encoded>,
  second: ValueCodecInput<Out, Mid>,
): Codec<Out, Encoded> {
  assertValueCodec(first, "pipe");
  assertValueCodec(second, "pipe");

  const firstCodec = promoteToCodec(first);
  const secondCodec = promoteToCodec(second);

  return createCodec<Out, Encoded>(
    (input, direction, collector) => {
      if (direction === "decode") {
        const mid = executeCodec(firstCodec, input, "decode", collector);
        if (mid === INVALID) return INVALID;
        return executeCodec(secondCodec, mid, "decode", collector);
      }
      const mid = executeCodec(secondCodec, input, "encode", collector);
      if (mid === INVALID) return INVALID;
      return executeCodec(firstCodec, mid, "encode", collector);
    },
    {
      descriptor: {
        kind: "pipe",
        first: firstCodec as Codec<unknown, unknown>,
        second: secondCodec as Codec<unknown, unknown>,
      },
    },
  );
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

function createCheckedCodec<T, Encoded>(
  base: Codec<T, Encoded>,
  rule: (value: T, context: CodecContext) => void,
  decodeSegmentMapper?: SegmentMapper,
): Codec<T, Encoded> {
  return createCodec<T, Encoded>(
    (input, direction, collector) => {
      const converted = executeCodec(base, input, direction, collector);
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
        if (isValidationError(error)) {
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
  return createCodec<T, Encoded>(
    (input, direction, collector) => {
      if (direction === "decode") {
        const decoded = executeCodec(base, input, "decode", collector);
        return decoded === INVALID ? INVALID : fn(decoded);
      }

      const firstPass = executeCodec(base, input, "encode", collector);
      if (firstPass === INVALID) return INVALID;
      const normalized = fn(input as T);
      if (Object.is(normalized, input)) return firstPass;
      return executeCodec(base, normalized, "encode", collector);
    },
    { decodeSegmentMapper, descriptor: getCodecDescriptor(base) },
  );
}

function runSafe<Result>(
  runner: (input: unknown, direction: CodecDirection, collector: IssueCollector) => unknown,
  input: unknown,
  direction: CodecDirection,
): SafeResult<Result> {
  const collector = createCollector();
  const output = runner(input, direction, collector);
  if (output === INVALID) {
    const frozenIssues = Object.freeze(collector.issues);
    return Object.freeze({ ok: false, issues: frozenIssues });
  }
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
  const mergedLiterals = deduplicateLiterals(existingState?.literals ?? [], addedLiterals);
  const literalState: LiteralState = {
    base: base as Codec<unknown, unknown>,
    literals: mergedLiterals,
  };

  return createCodec<T | Literals[number], Encoded | Literals[number]>(
    (input, direction, collector) => {
      for (const literal of mergedLiterals) {
        if (Object.is(input, literal)) return literal as Literals[number];
      }
      return executeCodec(base, input, direction, collector);
    },
    {
      literalState,
      descriptor: {
        kind: "or",
        base: literalState.base,
        literals: mergedLiterals,
      },
    },
  );
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
