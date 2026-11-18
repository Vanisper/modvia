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
          writeOwnField(data, key, codec.decode(input[source]));
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
        try {
          const fieldValue = readModelField(value, key);
          if (fieldValue === missingField) {
            if (optional) continue;
            issues.push({
              path: [key],
              code: "field.required",
              message: `Missing model field: ${key}`,
            });
            continue;
          }
          writeOwnField(output, source, codec.encode(fieldValue));
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

const missingField = Symbol("missing model field");

function writeOwnField(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function readModelField(value: Record<string, unknown>, key: string): unknown {
  if (Object.hasOwn(value, key)) return value[key];

  let prototype = Reflect.getPrototypeOf(value);
  while (prototype !== null && !isObjectPrototype(prototype)) {
    const descriptor: TypedPropertyDescriptor<unknown> | undefined =
      Object.getOwnPropertyDescriptor(prototype, key);
    if (descriptor) {
      // 最近的同名属性会遮蔽更远的 getter
      return descriptor.get ? Reflect.apply(descriptor.get, value, []) : missingField;
    }
    prototype = Reflect.getPrototypeOf(prototype);
  }
  return missingField;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!isObject(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || isObjectPrototype(prototype);
}

function isObjectPrototype(prototype: object): boolean {
  if (prototype === Object.prototype) return true;
  if (Reflect.getPrototypeOf(prototype) !== null) return false;

  // 其他上下文的内建 Object 经 Function.prototype 继承其自身的 Object.prototype
  const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (typeof constructor !== "function") return false;
  const functionPrototype = Reflect.getPrototypeOf(constructor);
  return functionPrototype !== null && Reflect.getPrototypeOf(functionPrototype) === prototype;
}
