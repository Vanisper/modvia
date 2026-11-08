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

export function field<T, Encoded>(codec: Codec<T, Encoded>): Field<T, Encoded> {
  return createField(codec, undefined);
}

export function fieldSource(codec: Codec<unknown, unknown>): string | undefined {
  return "source" in codec && typeof codec.source === "string" ? codec.source : undefined;
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
  return Object.freeze({
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
  });
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
      issues.push(...nested.issues);
    }
  }

  if (issues.length > 0) throw new ModelValidationError(issues);
  return output;
}
