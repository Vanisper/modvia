import {
  createCollector,
  INVALID,
  isAbortSignal,
  isValidationError,
  sharedContext,
  ValidationError,
  type Invalid,
  type IssueCollector,
} from "./errors.ts";
import type {
  Codec,
  CodecContext,
  CodecLike,
  Field,
  FieldLiteral,
  FieldPresence,
  SafeResult,
  StandardSchemaV1,
} from "./types.ts";

export type CodecDirection = "decode" | "encode";

export type InternalRunner<T, Encoded> = (
  input: unknown,
  direction: CodecDirection,
  collector: IssueCollector,
) => (T | Encoded) | Invalid;

const runnerSymbol = Symbol.for("modvia.codecRunner");
const literalStateSymbol = Symbol.for("modvia.literalState");
const fieldBrand = Symbol.for("modvia.Field");

interface LiteralState {
  readonly base: Codec<unknown, unknown>;
  readonly literals: readonly FieldLiteral[];
}

export interface CodecHandlers<T, Encoded> {
  decode(this: void, input: unknown, context: CodecContext): T;
  encode(this: void, value: T, context: CodecContext): Encoded;
}

/** 通过一对双向转换函数创建标准 Codec，两端均可通过 context.fail 报告校验失败 */
export function defineCodec<T, Encoded = T>(
  handlers: CodecHandlers<T, Encoded>,
): Codec<T, Encoded> {
  return createCodec<T, Encoded>((input, direction, collector) => {
    try {
      return direction === "decode"
        ? handlers.decode(input, sharedContext)
        : handlers.encode(input as T, sharedContext);
    } catch (error) {
      if (isAbortSignal(error)) {
        return collector.add(error.code, error.message);
      }
      if (isValidationError(error)) {
        return collector.addRelativeIssues(error.issues);
      }
      throw error;
    }
  });
}

export function createCodec<T, Encoded>(
  runner: (
    input: unknown,
    direction: CodecDirection,
    collector: IssueCollector,
  ) => (T | Encoded) | Invalid,
  literalState?: LiteralState,
): Codec<T, Encoded> {
  const safeDecode = (input: unknown): SafeResult<T> => runSafe<T>(runner, input, "decode");
  const safeEncode = (value: T): SafeResult<Encoded> => runSafe<Encoded>(runner, value, "encode");

  const decode = (input: unknown): T => {
    const result = safeDecode(input);
    if (!result.ok) throw new ValidationError(result.issues);
    return result.value;
  };

  const encode = (value: T): Encoded => {
    const result = safeEncode(value);
    if (!result.ok) throw new ValidationError(result.issues);
    return result.value;
  };

  const standardProps: StandardSchemaV1.Props<Encoded, T> = Object.freeze({
    version: 1,
    vendor: "modvia",
    validate(value: unknown): StandardSchemaV1.Result<T> {
      const result = safeDecode(value);
      return result.ok ? { value: result.value } : { issues: result.issues };
    },
  });

  const codec: Codec<T, Encoded> = {
    [Symbol.toStringTag]: "modvia.Codec",
    "~standard": standardProps,
    decode,
    encode,
    safeDecode,
    safeEncode,
    or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(...values: Literals) {
      assertValidLiterals(values);
      return createLiteralExtendedCodec<T, Encoded, Literals>(codec, values, literalState);
    },
    nullable() {
      return codec.or(null);
    },
    from<NextSource extends string>(source: NextSource) {
      assertValidSource(source);
      return createField(codec, source, "required");
    },
    optional() {
      return createField(codec, undefined, "optional");
    },
  };

  Object.defineProperty(codec, runnerSymbol, { value: runner });
  if (literalState) {
    Object.defineProperty(codec, literalStateSymbol, { value: literalState });
  }
  return Object.freeze(codec);
}

export function extendCodec<T, Encoded, Extra extends object>(
  base: Codec<T, Encoded>,
  extra: Extra,
): Codec<T, Encoded> & Extra {
  const runner = Reflect.get(base, runnerSymbol) as InternalRunner<T, Encoded> | undefined;
  const extended = {
    ...base,
    ...extra,
  };
  if (runner) {
    Object.defineProperty(extended, runnerSymbol, { value: runner });
  }
  return Object.freeze(extended);
}

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
    return direction === "decode" ? codec.decode(input) : codec.encode(input as T);
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

/** 包装已有字段并保留外部键名与缺省性 */
export function field<
  T,
  Encoded,
  Source extends string | undefined,
  Presence extends FieldPresence = "required",
>(input: Field<T, Encoded, Source, Presence>): Field<T, Encoded, Source, Presence>;
/** 将任意 Codec 或自定义 CodecLike 转为字段描述符 */
export function field<T, Encoded>(input: CodecLike<T, Encoded>): Field<T, Encoded>;
export function field<T, Encoded>(
  input: CodecLike<T, Encoded>,
): Field<T, Encoded, string | undefined, FieldPresence> {
  if (!isField(input)) {
    return createField(promoteToCodec(input), undefined, "required");
  }
  const { source, presence } = input;
  const inner = isStandardCodec(input.codec) ? input.codec : promoteToCodec(input);
  return createField(
    inner,
    typeof source === "string" ? source : undefined,
    presence === "optional" ? "optional" : "required",
  );
}

export function isField<T, Encoded>(
  value: CodecLike<T, Encoded>,
): value is Field<T, Encoded, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is Field<unknown, unknown, string | undefined, FieldPresence>;
export function isField(
  value: unknown,
): value is Field<unknown, unknown, string | undefined, FieldPresence> {
  if (typeof value !== "object" || value === null) return false;
  try {
    if (Reflect.get(value, fieldBrand) === true) return true;
    const candidate = value as Partial<Field<unknown, unknown, string | undefined, FieldPresence>>;
    return (
      candidate[Symbol.toStringTag] === "modvia.Field" &&
      (candidate.presence === "required" || candidate.presence === "optional") &&
      (candidate.source === undefined || typeof candidate.source === "string") &&
      typeof candidate.decode === "function" &&
      typeof candidate.encode === "function" &&
      typeof candidate.from === "function" &&
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
  if (isField(codec)) {
    throw new TypeError(
      `${caller} accepts a value Codec, not a Field with .from() or .optional(); apply field modifiers on the outer container or pass field.codec`,
    );
  }
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
): Field<T, Encoded, Source, Presence> {
  const runner = Reflect.get(codec, runnerSymbol) as InternalRunner<T, Encoded> | undefined;

  const fieldDescriptor: Field<T, Encoded, Source, Presence> & { readonly [fieldBrand]: true } = {
    [fieldBrand]: true,
    [Symbol.toStringTag]: "modvia.Field",
    "~standard": codec["~standard"],
    codec,
    source,
    presence,
    decode: codec.decode,
    encode: codec.encode,
    safeDecode: codec.safeDecode,
    safeEncode: codec.safeEncode,
    from<NextSource extends string>(nextSource: NextSource) {
      assertValidSource(nextSource);
      return createField(codec, nextSource, presence);
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
    or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(...values: Literals) {
      return createField(codec.or(...values), source, presence);
    },
    nullable() {
      return createField(codec.nullable(), source, presence);
    },
  };

  if (runner) {
    Object.defineProperty(fieldDescriptor, runnerSymbol, { value: runner });
  }
  return Object.freeze(fieldDescriptor);
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
  const mergedLiterals = mergeLiterals(existingState?.literals ?? [], addedLiterals);

  return createCodec<T | Literals[number], Encoded | Literals[number]>(
    (input, direction, collector) => {
      for (const literal of mergedLiterals) {
        if (Object.is(input, literal)) return literal as Literals[number];
      }
      return executeCodec(base, input, direction, collector);
    },
    {
      base: base as Codec<unknown, unknown>,
      literals: mergedLiterals,
    },
  );
}

function mergeLiterals(
  existing: readonly FieldLiteral[],
  added: readonly FieldLiteral[],
): readonly FieldLiteral[] {
  const result = [...existing];
  for (const candidate of added) {
    if (!result.some((item) => Object.is(item, candidate))) {
      result.push(candidate);
    }
  }
  return Object.freeze(result);
}

function isStandardCodec<T, Encoded>(value: CodecLike<T, Encoded>): value is Codec<T, Encoded>;
function isStandardCodec(value: unknown): value is Codec<unknown, unknown>;
function isStandardCodec(value: unknown): value is Codec<unknown, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Partial<Codec<unknown, unknown>>)[Symbol.toStringTag] === "modvia.Codec" &&
    typeof Reflect.get(value, runnerSymbol) === "function"
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
  if (values.length === 0 || !values.every(isFieldLiteral)) {
    throw new TypeError(
      "or requires at least one string, number, boolean, null, or undefined literal",
    );
  }
}

function isFieldLiteral(value: unknown): value is FieldLiteral {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}
