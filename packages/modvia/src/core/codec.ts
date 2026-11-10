import { fail, ModelValidationError, nestValidationError } from "./errors.ts";
import type { Codec, CodecContext, Field, ModelIssue } from "./types.ts";

interface CodecHandlers<T, Encoded> {
  decode(input: unknown, context: CodecContext): T;
  encode(value: T, context: CodecContext): Encoded;
}

const context: CodecContext = Object.freeze({
  fail(code: string, message: string) {
    return fail([], code, message);
  },
});

const fieldBrand = Symbol.for("modvia.Field");

export function defineCodec<T, Encoded>(handlers: CodecHandlers<T, Encoded>): Codec<T, Encoded> {
  return Object.freeze({
    decode(input: unknown) {
      return handlers.decode(input, context);
    },
    encode(value: T) {
      return handlers.encode(value, context);
    },
  });
}

export function field<T, Encoded, Source extends string>(
  codec: Field<T, Encoded, Source>,
): Field<T, Encoded, Source>;
export function field<T, Encoded>(codec: Codec<T, Encoded>): Field<T, Encoded>;
export function field<T, Encoded>(codec: Codec<T, Encoded>): Field<T, Encoded, string | undefined> {
  return createField(codec, fieldSource(codec));
}

export function fieldSource(codec: Codec<unknown, unknown>): string | undefined {
  if (!isField(codec)) return undefined;
  const { source } = codec;
  return typeof source === "string" ? source : undefined;
}

function isField(codec: unknown): codec is Field<unknown, unknown, string | undefined> {
  if (typeof codec !== "object" || codec === null) return false;
  try {
    return Reflect.get(codec, fieldBrand) === true;
  } catch {
    return false;
  }
}

export function arrayOf<T, Encoded>(codec: Codec<T, Encoded>): Codec<T[], Encoded[]> {
  return defineCodec<T[], Encoded[]>({
    decode(input, context) {
      if (!Array.isArray(input)) return context.fail("type.array", "Expected an array");
      return mapArray(input, (item) => codec.decode(item));
    },
    encode(input, context) {
      if (!Array.isArray(input)) return context.fail("type.array", "Expected an array");
      return mapArray(input, (item) => codec.encode(item));
    },
  });
}

function createField<T, Encoded, Source extends string | undefined>(
  codec: Codec<T, Encoded>,
  source: Source,
): Field<T, Encoded, Source> {
  const fieldCodec: Field<T, Encoded, Source> = {
    source,
    decode(input: unknown) {
      return codec.decode(input);
    },
    encode(value: T) {
      return codec.encode(value);
    },
    from<NextSource extends string>(nextSource: NextSource) {
      return createField(codec, nextSource);
    },
  };
  Object.defineProperty(fieldCodec, fieldBrand, { value: true });
  return Object.freeze(fieldCodec);
}

function mapArray<Input, Output>(
  input: readonly Input[],
  convert: (value: Input) => Output,
): Output[] {
  const output: Output[] = [];
  const issues: ModelIssue[] = [];

  for (const [index, item] of input.entries()) {
    try {
      output.push(convert(item));
    } catch (error) {
      const nested = nestValidationError(error, index);
      if (!nested) throw error;
      for (const issue of nested.issues) issues.push(issue);
    }
  }

  if (issues.length > 0) throw new ModelValidationError(issues);
  return output;
}
