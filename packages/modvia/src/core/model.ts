import { fieldSource } from "./codec.ts";
import { fail, ModelValidationError, nestValidationError } from "./errors.ts";
import type { Codec, Field, Model, ModelIssue } from "./types.ts";

type FieldRecord = Readonly<Record<string, Codec<unknown, unknown>>>;

type DataOf<Fields extends FieldRecord> = {
  readonly [Key in keyof Fields]: Fields[Key] extends Codec<infer Value, infer _Encoded>
    ? Value
    : never;
};

type SourceOf<FieldCodec, Fallback extends PropertyKey> =
  FieldCodec extends Field<infer _Value, infer _Encoded, infer Source>
    ? Source extends string
      ? Source
      : Fallback
    : Fallback;

type DTOOf<Fields extends FieldRecord> = {
  [Key in keyof Fields as SourceOf<Fields[Key], Key>]: Fields[Key] extends Codec<
    infer _Value,
    infer Encoded
  >
    ? Encoded
    : never;
};

export function defineModel<const Fields extends FieldRecord>(options: {
  readonly fields: Fields;
}): Model<DataOf<Fields>, DTOOf<Fields>> {
  const fields: Fields = Object.freeze({ ...options.fields });
  assertUniqueSources(fields);
  return createModel(fields, (data) => data);
}

function createModel<Data, DTO, Out extends Data>(
  fields: FieldRecord,
  factory: (data: Data) => Out,
): Model<Data, DTO, Out> {
  return Object.freeze({
    decode(input: unknown): Out {
      if (!isObject(input)) fail([], "type.object", "Expected an object");
      const data: Record<string, unknown> = {};
      const issues: ModelIssue[] = [];

      for (const [key, codec] of Object.entries(fields)) {
        const source = fieldSource(codec) ?? key;
        if (!Object.hasOwn(input, source)) {
          issues.push({
            path: [source],
            code: "field.required",
            message: `Missing required field: ${source}`,
          });
          continue;
        }
        try {
          data[key] = codec.decode(input[source]);
        } catch (error) {
          const nested = nestValidationError(error, source);
          if (!nested) throw error;
          issues.push(...nested.issues);
        }
      }

      if (issues.length > 0) throw new ModelValidationError(issues);
      return factory(data as Data);
    },

    encode(value: Out): DTO {
      if (!isObject(value)) fail([], "type.object", "Expected a model object");
      const output: Record<string, unknown> = {};
      const issues: ModelIssue[] = [];

      for (const [key, codec] of Object.entries(fields)) {
        if (!Object.hasOwn(value, key)) {
          issues.push({
            path: [key],
            code: "field.required",
            message: `Missing model field: ${key}`,
          });
          continue;
        }
        const source = fieldSource(codec) ?? key;
        try {
          output[source] = codec.encode(value[key]);
        } catch (error) {
          const nested = nestValidationError(error, key);
          if (!nested) throw error;
          issues.push(...nested.issues);
        }
      }

      if (issues.length > 0) throw new ModelValidationError(issues);
      return output as DTO;
    },

    withFactory<Next extends Data>(nextFactory: (data: Data) => Next) {
      return createModel<Data, DTO, Next>(fields, nextFactory);
    },
  });
}

function assertUniqueSources(fields: FieldRecord): void {
  const owners = new Map<string, string>();
  for (const [key, codec] of Object.entries(fields)) {
    const source = fieldSource(codec) ?? key;
    const owner = owners.get(source);
    if (owner !== undefined) {
      throw new RangeError(`Duplicate field source "${source}" used by "${owner}" and "${key}"`);
    }
    owners.set(source, key);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
