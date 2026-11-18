import { isField } from "./codec.ts";
import { fail, ModelValidationError, nestValidationError } from "./errors.ts";
import type { FieldRecord, ModelOf } from "./model-types.ts";
import type { Codec, Model, ModelIssue } from "./types.ts";

interface ResolvedField {
  readonly key: string;
  readonly source: string;
  readonly optional: boolean;
  readonly codec: Codec<unknown, unknown>;
}

/** 声明对象字段，并推导业务数据和外部 DTO */
export function defineModel<const Fields extends FieldRecord>(options: {
  readonly fields: Fields;
}): ModelOf<Fields> {
  const fields: Fields = Object.freeze({ ...options.fields });
  const resolvedFields = resolveFields(fields);
  assertNoReservedNames(resolvedFields);
  assertUniqueSources(resolvedFields);
  return createModel(resolvedFields, (data) => data);
}

function createModel<Data, DTO, Out extends Data>(
  resolvedFields: readonly ResolvedField[],
  factory: (data: Data) => Out,
): Model<Data, DTO, Out> {
  return Object.freeze({
    decode(input: unknown): Out {
      if (!isPlainObject(input)) fail([], "type.object", "Expected a plain object");
      const data: Record<string, unknown> = {};
      const issues: ModelIssue[] = [];

      for (const { key, source, optional, codec } of resolvedFields) {
        if (!Object.hasOwn(input, source)) {
          if (optional) continue;
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
          for (const issue of nested.issues) issues.push(issue);
        }
      }

      if (issues.length > 0) throw new ModelValidationError(issues);
      return factory(data as Data);
    },

    encode(value: Out): DTO {
      if (!isObject(value)) fail([], "type.object", "Expected a model object");
      const output: Record<string, unknown> = {};
      const issues: ModelIssue[] = [];

      for (const { key, source, optional, codec } of resolvedFields) {
        if (!Object.hasOwn(value, key)) {
          if (optional) continue;
          issues.push({
            path: [key],
            code: "field.required",
            message: `Missing model field: ${key}`,
          });
          continue;
        }
        try {
          output[source] = codec.encode(value[key]);
        } catch (error) {
          const nested = nestValidationError(error, key);
          if (!nested) throw error;
          for (const issue of nested.issues) issues.push(issue);
        }
      }

      if (issues.length > 0) throw new ModelValidationError(issues);
      return output as DTO;
    },

    withFactory<Next extends Data>(nextFactory: (data: Data) => Next) {
      return createModel<Data, DTO, Next>(resolvedFields, nextFactory);
    },
  });
}

function resolveFields(fields: FieldRecord): ResolvedField[] {
  return Object.entries(fields).map(([key, codec]) => {
    const field = isField(codec) ? codec : undefined;
    const source = field?.source;
    return {
      key,
      codec,
      source: typeof source === "string" ? source : key,
      optional: field?.presence === "optional",
    };
  });
}

function assertNoReservedNames(resolvedFields: readonly ResolvedField[]): void {
  for (const { key, source } of resolvedFields) {
    if (key === "__proto__" || source === "__proto__") {
      throw new RangeError(
        `Field "${key}" uses reserved name "__proto__"; it would assign the result prototype instead of a field`,
      );
    }
  }
}

function assertUniqueSources(resolvedFields: readonly ResolvedField[]): void {
  const owners = new Map<string, string>();
  for (const { key, source } of resolvedFields) {
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

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
