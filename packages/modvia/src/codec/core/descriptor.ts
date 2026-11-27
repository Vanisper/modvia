import { deduplicateLiterals } from "../../shared/value.ts";
import type { SegmentMapper } from "./context.ts";
import { isFieldLike } from "./field.ts";
import { descriptorOf } from "./internals.ts";
import type {
  CodecDescriptor,
  CodecOrField,
  CodecRefinement,
  FieldLiteral,
  PathSegment,
  StandardCodec,
} from "./types.ts";

type Defined<T> = { [K in keyof T]: Exclude<T[K], undefined> };

/** 剔除值为 undefined 的键：描述符只保留真实存在的结构信息 */
export function compact<T extends object>(value: T): Defined<T> {
  const output: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) output[key] = entry;
  }
  return output as Defined<T>;
}

/** 读取任意 Codec、Field 或自定义 CodecLike 的只读结构描述符（Field 自动叠加槽位级 description） */
export function inspectCodec(value: CodecOrField): CodecDescriptor {
  if (isFieldLike(value)) {
    const inner = descriptorOf(value.codec);
    return value.description !== undefined
      ? Object.freeze({ ...inner, description: value.description })
      : inner;
  }
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value.decode !== "function" ||
    typeof value.encode !== "function"
  ) {
    throw new TypeError("Codec.inspect requires a valid Codec, Field, or CodecLike object");
  }
  return descriptorOf(value);
}

/** 构造精化节点描述符：相邻精化层扁平合并，inner 恒为非精化节点并保留外层已声明的说明 */
export function refinedDescriptor(
  base: StandardCodec,
  refinement: CodecRefinement,
): CodecDescriptor {
  const baseDescriptor = descriptorOf(base);
  if (baseDescriptor.kind === "refined") {
    return compact({
      kind: "refined" as const,
      inner: baseDescriptor.inner,
      refinements: Object.freeze([...baseDescriptor.refinements, Object.freeze(refinement)]),
      description: baseDescriptor.description,
    });
  }
  return {
    kind: "refined",
    inner: base,
    refinements: Object.freeze([Object.freeze(refinement)]),
  };
}

/**
 * 从描述符推导静态字面量集合（供 Model.union 判别分发）
 *
 * @description literal 直接给出取值；or 为内层静态字面量与哨兵的并集；精化节点可能拒绝其中部分取值，因此不再视为静态
 */
export function staticLiterals(codec: object): readonly FieldLiteral[] | undefined {
  const descriptor = descriptorOf(codec);
  switch (descriptor.kind) {
    case "literal":
      return descriptor.values;
    case "or": {
      const inner = staticLiterals(descriptor.base);
      return inner === undefined ? undefined : deduplicateLiterals(descriptor.literals, inner);
    }
    default:
      return undefined;
  }
}

const modelKeyMappers = new WeakMap<object, SegmentMapper>();

/**
 * 从描述符推导解码侧路径首段翻译器（模型声明字段名 → 外部 DTO 键名）
 *
 * @description model 生成键映射；pipe 复合两端；or / refined / lazy 穿透到内层；其余节点无映射
 */
export function pathMapperOf(codec: object): SegmentMapper | undefined {
  const descriptor = descriptorOf(codec);
  switch (descriptor.kind) {
    case "model":
      return modelKeyMapper(descriptor.fields);
    case "pipe": {
      const outer = pathMapperOf(descriptor.first);
      const inner = pathMapperOf(descriptor.second);
      if (outer !== undefined && inner !== undefined) return (segment) => outer(inner(segment));
      return inner ?? outer;
    }
    case "or":
      return pathMapperOf(descriptor.base);
    case "refined":
      return pathMapperOf(descriptor.inner);
    case "lazy":
      return pathMapperOf(descriptor.resolve());
    default:
      return undefined;
  }
}

function modelKeyMapper(fields: Readonly<Record<string, CodecOrField>>): SegmentMapper {
  let mapper = modelKeyMappers.get(fields);
  if (mapper === undefined) {
    const sourceByKey = new Map<string, string>();
    for (const [key, entry] of Object.entries(fields)) {
      sourceByKey.set(
        key,
        isFieldLike(entry) && typeof entry.source === "string" ? entry.source : key,
      );
    }
    mapper = (segment: PathSegment) =>
      typeof segment === "string" ? (sourceByKey.get(segment) ?? segment) : segment;
    modelKeyMappers.set(fields, mapper);
  }
  return mapper;
}
