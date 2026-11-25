import { Codec, Field, type CodecDescriptor, type CodecOrField, type FieldLiteral } from "modvia";
import type {
  JsonSchemaObject,
  JsonSchemaSide,
  JsonSchemaTarget,
  ToJsonSchemaOptions,
} from "./types.ts";

const DRAFT_2020_12_URI = "https://json-schema.org/draft/2020-12/schema";
const DRAFT_07_URI = "http://json-schema.org/draft-07/schema#";

interface ConversionContext {
  readonly target: JsonSchemaTarget;
  readonly additionalProperties: boolean;
  readonly strict: boolean;
  readonly activeStack: Set<string>;
  readonly defNames: Map<string, string>;
  readonly defs: Map<string, JsonSchemaObject>;
  readonly codecIds: WeakMap<object, number>;
  nextCodecId: number;
  nextDefIndex: number;
}

/**
 * 将任意 Modvia Codec、Field 或 Model 导出为标准 JSON Schema / OpenAPI Schema 对象
 *
 * @description 默认导出外部传输侧（side: "dto"），自动应用字段 .alias() / 模型级 alias 策略、默认值可选化及 isoDateTime 字符串格式
 */
export function toJsonSchema(
  codec: CodecOrField,
  options: ToJsonSchemaOptions = {},
): JsonSchemaObject {
  const target = normalizeTarget(options.target ?? "draft-2020-12");
  const side: JsonSchemaSide = options.side ?? "dto";
  const includeSchemaUri = options.includeSchemaUri ?? true;
  const additionalProperties = options.additionalProperties ?? false;
  const strict = Boolean(options.strict);

  const context: ConversionContext = {
    target,
    additionalProperties,
    strict,
    activeStack: new Set(),
    defNames: new Map(),
    defs: new Map(),
    codecIds: new WeakMap(),
    nextCodecId: 1,
    nextDefIndex: 0,
  };

  const rootBody = convertNode(codec, side, context);
  const defsKey = target === "draft-07" ? "definitions" : "$defs";

  const output: JsonSchemaObject = {};
  if (includeSchemaUri && target === "draft-2020-12") {
    output.$schema = DRAFT_2020_12_URI;
  } else if (includeSchemaUri && target === "draft-07") {
    output.$schema = DRAFT_07_URI;
  }

  Object.assign(output, rootBody);

  if (context.defs.size > 0) {
    const defsObject: Record<string, JsonSchemaObject> = {};
    for (const [name, schema] of context.defs) {
      defsObject[name] = schema;
    }
    output[defsKey] = defsObject;
  }

  return output;
}

function normalizeTarget(raw: string): JsonSchemaTarget {
  if (raw === "draft-2020-12" || raw === "draft-07" || raw === "openapi-3.0") {
    return raw;
  }
  throw new RangeError(
    `Unsupported JSON Schema target "${raw}"; supported targets are "draft-2020-12", "draft-07", and "openapi-3.0"`,
  );
}

function getNodeKey(codec: CodecOrField, side: JsonSchemaSide, context: ConversionContext): string {
  const targetObj = Field.is(codec) ? codec.codec : codec;
  let id = context.codecIds.get(targetObj);
  if (id === undefined) {
    id = context.nextCodecId++;
    context.codecIds.set(targetObj, id);
  }
  return `${id}:${side}`;
}

function makeRef(defName: string, target: JsonSchemaTarget): JsonSchemaObject {
  const prefix = target === "draft-07" ? "#/definitions" : "#/$defs";
  return { $ref: `${prefix}/${defName}` };
}

function convertNode(
  codec: CodecOrField,
  side: JsonSchemaSide,
  context: ConversionContext,
): JsonSchemaObject {
  if (Field.is(codec)) {
    const innerSchema = convertNode(codec.codec, side, context);
    return codec.description !== undefined
      ? { ...innerSchema, description: codec.description }
      : innerSchema;
  }

  const descriptor = Codec.inspect(codec);

  // lazy 节点先穿透到实际目标 Codec，再统一按目标身份检测递归环
  if (descriptor.kind === "lazy") {
    const resolvedSchema = convertNode(descriptor.resolve(), side, context);
    return descriptor.description !== undefined
      ? { ...resolvedSchema, description: descriptor.description }
      : resolvedSchema;
  }

  const nodeKey = getNodeKey(codec, side, context);
  const existingDef = context.defNames.get(nodeKey);
  if (existingDef !== undefined && context.defs.has(existingDef)) {
    return makeRef(existingDef, context.target);
  }

  if (context.activeStack.has(nodeKey)) {
    let defName = existingDef;
    if (defName === undefined) {
      defName = `def_${context.nextDefIndex++}`;
      context.defNames.set(nodeKey, defName);
    }
    return makeRef(defName, context.target);
  }

  context.activeStack.add(nodeKey);
  let built: JsonSchemaObject;
  try {
    built = convertDescriptor(descriptor, side, context);
  } finally {
    context.activeStack.delete(nodeKey);
  }

  const assignedDef = context.defNames.get(nodeKey);
  if (assignedDef !== undefined) {
    context.defs.set(assignedDef, built);
    return makeRef(assignedDef, context.target);
  }

  return built;
}

function convertDescriptor(
  descriptor: CodecDescriptor,
  side: JsonSchemaSide,
  context: ConversionContext,
): JsonSchemaObject {
  const schema = buildDescriptorSchema(descriptor, side, context);
  if (descriptor.description !== undefined) {
    return { ...schema, description: descriptor.description };
  }
  return schema;
}

function buildDescriptorSchema(
  descriptor: CodecDescriptor,
  side: JsonSchemaSide,
  context: ConversionContext,
): JsonSchemaObject {
  switch (descriptor.kind) {
    case "string": {
      const schema: JsonSchemaObject = { type: "string" };
      if (descriptor.format !== undefined) schema.format = descriptor.format;
      if (descriptor.minLength !== undefined) schema.minLength = descriptor.minLength;
      if (descriptor.maxLength !== undefined) schema.maxLength = descriptor.maxLength;
      if (descriptor.pattern !== undefined) schema.pattern = descriptor.pattern;
      return schema;
    }
    case "number":
    case "integer": {
      const schema: JsonSchemaObject = { type: descriptor.kind };
      if (descriptor.min !== undefined) schema.minimum = descriptor.min;
      if (descriptor.max !== undefined) schema.maximum = descriptor.max;
      if (descriptor.exclusiveMin !== undefined) {
        if (context.target === "openapi-3.0") {
          schema.minimum = descriptor.exclusiveMin;
          schema.exclusiveMinimum = true;
        } else {
          schema.exclusiveMinimum = descriptor.exclusiveMin;
        }
      }
      if (descriptor.exclusiveMax !== undefined) {
        if (context.target === "openapi-3.0") {
          schema.maximum = descriptor.exclusiveMax;
          schema.exclusiveMaximum = true;
        } else {
          schema.exclusiveMaximum = descriptor.exclusiveMax;
        }
      }
      return schema;
    }
    case "bigint": {
      if (context.strict) {
        throw new TypeError(
          "Native bigint cannot be represented in strict JSON Schema; use bigint().fromString() for string wire representation",
        );
      }
      return {};
    }
    case "numericString": {
      if (side === "dto") {
        return descriptor.numericKind === "number"
          ? { type: "string" }
          : { type: "string", pattern: "^[+-]?\\d+$" };
      }
      if (descriptor.numericKind === "bigint") {
        if (context.strict) {
          throw new TypeError(
            "Native bigint cannot be represented in strict JSON Schema; use bigint().fromString() for string wire representation",
          );
        }
        return {};
      }
      return { type: descriptor.numericKind };
    }
    case "boolean":
      return { type: "boolean" };
    case "booleanString": {
      if (side === "data") return { type: "boolean" };
      if (descriptor.caseSensitive) {
        return {
          type: "string",
          enum: [...new Set([...descriptor.truthy, ...descriptor.falsy])],
        };
      }
      return { type: "string" };
    }
    case "unknown":
      return {};
    case "literal":
      return convertLiterals(descriptor.values, context);
    case "datetime": {
      if (side === "dto") {
        return { type: "string", format: "date-time" };
      }
      if (context.strict) {
        throw new TypeError(
          'Native Date on "data" side cannot be represented in strict JSON Schema',
        );
      }
      return {};
    }
    case "json":
      return side === "dto" ? { type: "string" } : {};
    case "array": {
      const schema: JsonSchemaObject = {
        type: "array",
        items: convertNode(descriptor.item, side, context),
      };
      if (descriptor.minLength !== undefined) schema.minItems = descriptor.minLength;
      if (descriptor.maxLength !== undefined) schema.maxItems = descriptor.maxLength;
      return schema;
    }
    case "tuple": {
      const itemSchemas = descriptor.items.map((item) => convertNode(item, side, context));
      if (context.target === "draft-2020-12") {
        return {
          type: "array",
          prefixItems: itemSchemas,
          minItems: itemSchemas.length,
          maxItems: itemSchemas.length,
        };
      }
      return {
        type: "array",
        items: itemSchemas,
        minItems: itemSchemas.length,
        maxItems: itemSchemas.length,
        ...(context.target === "draft-07" ? { additionalItems: false } : {}),
      };
    }
    case "record": {
      const valueSchema = convertNode(descriptor.value, side, context);
      if (descriptor.key === undefined) {
        return {
          type: "object",
          additionalProperties: valueSchema,
        };
      }
      const keyDescriptor = Codec.inspect(descriptor.key);
      if (context.target === "openapi-3.0") {
        if (
          keyDescriptor.kind === "literal" &&
          keyDescriptor.values.every((value): value is string => typeof value === "string")
        ) {
          const properties: Record<string, JsonSchemaObject> = {};
          for (const key of keyDescriptor.values) {
            properties[key] = valueSchema;
          }
          return {
            type: "object",
            properties,
            additionalProperties: false,
          };
        }
        return {
          type: "object",
          additionalProperties: valueSchema,
        };
      }
      return {
        type: "object",
        propertyNames: convertNode(descriptor.key, side, context),
        additionalProperties: valueSchema,
      };
    }
    case "or": {
      const baseSchema = convertNode(descriptor.base, side, context);
      if (
        context.target === "openapi-3.0" &&
        descriptor.literals.length === 1 &&
        descriptor.literals[0] === null &&
        typeof baseSchema.type === "string"
      ) {
        return { ...baseSchema, nullable: true };
      }
      const literalBranches = descriptor.literals.map((lit) => convertSingleLiteral(lit, context));
      return { anyOf: [baseSchema, ...literalBranches] };
    }
    case "union": {
      return {
        anyOf: descriptor.branches.map((branch) => convertNode(branch, side, context)),
      };
    }
    case "taggedUnion": {
      const oneOf = descriptor.branches.map((branch) => convertNode(branch, side, context));
      if (context.target === "openapi-3.0") {
        const propertyName = side === "dto" ? descriptor.externalKey : descriptor.discriminator;
        return {
          oneOf,
          discriminator: { propertyName },
        };
      }
      return { oneOf };
    }
    case "model": {
      const properties: Record<string, JsonSchemaObject> = {};
      const required: string[] = [];

      for (const [internalKey, entry] of Object.entries(descriptor.fields)) {
        const fieldMeta = Field.is(entry) ? entry : undefined;
        const propName =
          side === "dto" && typeof fieldMeta?.source === "string" ? fieldMeta.source : internalKey;
        const presence = fieldMeta?.presence ?? "required";

        properties[propName] = convertNode(entry, side, context);

        if (presence === "required" || (side === "data" && presence === "defaulted")) {
          required.push(propName);
        }
      }

      return {
        type: "object",
        properties,
        ...(required.length > 0 ? { required } : {}),
        additionalProperties: descriptor.strict ? false : context.additionalProperties,
      };
    }
    case "refined": {
      // 精化步骤为不透明运行时约束，Schema 按内层结构诚实导出
      return convertNode(descriptor.inner, side, context);
    }
    case "pipe": {
      return side === "dto"
        ? convertNode(descriptor.first, "dto", context)
        : convertNode(descriptor.second, "data", context);
    }
    case "invert": {
      const invertedSide: JsonSchemaSide = side === "dto" ? "data" : "dto";
      return convertNode(descriptor.inner, invertedSide, context);
    }
    case "lazy": {
      return convertNode(descriptor.resolve(), side, context);
    }
    case "custom": {
      const schemaFragment = side === "dto" ? descriptor.encodedSchema : descriptor.decodedSchema;
      if (schemaFragment !== undefined) {
        const cloned: JsonSchemaObject = { ...schemaFragment };
        if (context.target === "openapi-3.0") {
          if (typeof cloned.exclusiveMinimum === "number") {
            cloned.minimum = cloned.exclusiveMinimum;
            cloned.exclusiveMinimum = true;
          }
          if (typeof cloned.exclusiveMaximum === "number") {
            cloned.maximum = cloned.exclusiveMaximum;
            cloned.exclusiveMaximum = true;
          }
        }
        return cloned;
      }
      if (context.strict) {
        throw new TypeError(
          `Custom codec${descriptor.format ? ` (${descriptor.format})` : ""} has no JSON Schema metadata in strict mode`,
        );
      }
      return {};
    }
  }
}

function convertLiterals(
  values: readonly FieldLiteral[],
  context: ConversionContext,
): JsonSchemaObject {
  if (values.length === 1) {
    return convertSingleLiteral(values[0], context);
  }
  const hasUndefined = values.some((v) => v === undefined);
  if (hasUndefined && context.strict) {
    throw new TypeError("Literal undefined cannot be represented in strict JSON Schema");
  }
  const jsonSafe = values.filter((v) => v !== undefined && !Number.isNaN(v));
  if (jsonSafe.length === 0) return {};

  const firstType = jsonPrimitiveType(jsonSafe[0]);
  const homogeneous =
    firstType !== null && jsonSafe.every((v) => jsonPrimitiveType(v) === firstType);
  if (homogeneous && firstType !== "null") {
    return { type: firstType, enum: [...jsonSafe] };
  }
  return { enum: [...jsonSafe] };
}

function convertSingleLiteral(
  value: FieldLiteral | undefined,
  context: ConversionContext,
): JsonSchemaObject {
  if (value === undefined || Number.isNaN(value)) {
    if (context.strict) {
      throw new TypeError(`Literal ${String(value)} cannot be represented in strict JSON Schema`);
    }
    return {};
  }
  if (value === null) {
    return context.target === "openapi-3.0" ? { nullable: true } : { type: "null" };
  }
  const primitiveType = jsonPrimitiveType(value);
  if (context.target === "openapi-3.0") {
    return { ...(primitiveType ? { type: primitiveType } : {}), enum: [value] };
  }
  return { const: value };
}

function jsonPrimitiveType(value: FieldLiteral | undefined): string | null {
  if (value === null) return "null";
  if (typeof value === "string") return "string";
  if (typeof value === "boolean") return "boolean";
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isSafeInteger(value) ? "integer" : "number";
  }
  return null;
}
