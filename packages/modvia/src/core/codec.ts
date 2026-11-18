import { fail, ModelValidationError, nestValidationError } from "./errors.ts";
import type {
  Codec,
  CodecContext,
  Field,
  FieldLiteral,
  FieldPresence,
  ModelIssue,
} from "./types.ts";

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

/** 通过一对转换函数创建 Codec，两端均可用 context.fail 报告校验失败 */
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

/** 包装已有字段，保留外部名、键的缺省规则和值转换 */
export function field<
  T,
  Encoded,
  Source extends string | undefined,
  Presence extends FieldPresence = "required",
>(codec: Field<T, Encoded, Source, Presence>): Field<T, Encoded, Source, Presence>;
/** 将任意 Codec 包装为可修饰的必填字段 */
export function field<T, Encoded>(codec: Codec<T, Encoded>): Field<T, Encoded>;
export function field<T, Encoded>(
  codec: Codec<T, Encoded>,
): Field<T, Encoded, string | undefined, FieldPresence> {
  if (!isField(codec)) return createField(codec, undefined, "required");
  const { source, presence } = codec;
  return createField(
    codec,
    typeof source === "string" ? source : undefined,
    presence === "optional" ? "optional" : "required",
  );
}

export function isField<T, Encoded>(
  codec: Codec<T, Encoded>,
): codec is Field<T, Encoded, string | undefined, FieldPresence> {
  if (typeof codec !== "object" || codec === null) return false;
  try {
    return Reflect.get(codec, fieldBrand) === true;
  } catch {
    return false;
  }
}

/**
 * 按元素规则编解码数组，元素错误保留下标
 *
 * @description 返回独立的必填字段，数组的外部名和缺省规则可在返回值上指定
 */
export function arrayOf<T, Encoded>(codec: Codec<T, Encoded>): Field<T[], Encoded[]> {
  return field(
    defineCodec<T[], Encoded[]>({
      decode(input, context) {
        if (!Array.isArray(input)) return context.fail("type.array", "Expected an array");
        return mapArray(input, (item) => codec.decode(item));
      },
      encode(input, context) {
        if (!Array.isArray(input)) return context.fail("type.array", "Expected an array");
        return mapArray(input, (item) => codec.encode(item));
      },
    }),
  );
}

function createField<T, Encoded, Source extends string | undefined, Presence extends FieldPresence>(
  codec: Codec<T, Encoded>,
  source: Source,
  presence: Presence,
): Field<T, Encoded, Source, Presence> {
  const fieldCodec: Field<T, Encoded, Source, Presence> = {
    source,
    presence,
    decode(input: unknown) {
      return codec.decode(input);
    },
    encode(value: T) {
      return codec.encode(value);
    },
    from<NextSource extends string>(nextSource: NextSource) {
      return createField(codec, nextSource, presence);
    },
    or<const Literal extends FieldLiteral>(literal: Literal) {
      if (arguments.length !== 1 || !isFieldLiteral(literal)) {
        throw new TypeError("or requires exactly one string, number, boolean, null, or undefined");
      }
      const matches = (value: unknown): value is Literal => Object.is(value, literal);
      const extended: Codec<T | Literal, Encoded | Literal> = {
        decode(input) {
          return matches(input) ? literal : codec.decode(input);
        },
        encode(value) {
          return matches(value) ? literal : codec.encode(value);
        },
      };
      return createField(extended, source, presence);
    },
    optional() {
      return createField(codec, source, "optional");
    },
  };
  // 对象展开会保留字段类型，品牌也须随字段元数据一起复制
  Object.defineProperty(fieldCodec, fieldBrand, { value: true, enumerable: true });
  return Object.freeze(fieldCodec);
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
