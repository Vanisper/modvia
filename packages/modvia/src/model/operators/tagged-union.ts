import { INVALID } from "../../codec/core/collector.ts";
import { createCodec, executeCodec, getStaticLiterals } from "../../codec/core/runtime.ts";
import type { Codec, FieldLiteral, InferEncoded, InferValue } from "../../codec/core/types.ts";
import { isObject, isPlainObject } from "../../shared/object.ts";
import { formatLiteral } from "../../shared/value.ts";
import {
  missingField,
  readModelField,
  resolvedFieldsSymbol,
  type ResolvedField,
} from "../core/fields.ts";
import type { TaggedModelLike } from "../core/types.ts";

/**
 * 按共有字面量判别字段组合多个模型，实现 O(1) 多态双向分发
 *
 * @description 解码按判别字段的外部键名查找分支，编码支持读取普通属性或原型链 getter
 */
export function taggedUnion<
  Discriminator extends string,
  const Branches extends readonly [
    TaggedModelLike<Discriminator>,
    TaggedModelLike<Discriminator>,
    ...TaggedModelLike<Discriminator>[],
  ],
>(
  discriminator: Discriminator,
  branches: Branches,
): Codec<InferValue<Branches[number]>, InferEncoded<Branches[number]>> {
  if (typeof discriminator !== "string") {
    throw new TypeError("taggedUnion discriminator must be a string field name");
  }
  if (!Array.isArray(branches) || branches.length < 2) {
    throw new RangeError("taggedUnion requires at least two branch models");
  }

  let wireSource: string | undefined;
  const branchByTag = new Map<FieldLiteral, TaggedModelLike<Discriminator>>();

  for (const branch of branches) {
    const resolvedFields = Reflect.get(branch, resolvedFieldsSymbol) as
      | readonly ResolvedField[]
      | undefined;
    if (!Array.isArray(resolvedFields)) {
      throw new TypeError("taggedUnion branches must be models created with defineModel");
    }

    const discField = resolvedFields.find((field) => field.key === discriminator);
    if (!discField) {
      throw new RangeError(`Branch model is missing discriminator field "${discriminator}"`);
    }
    if (discField.presence !== "required") {
      throw new RangeError(
        `Discriminator field "${discriminator}" must be required in every branch`,
      );
    }

    if (wireSource === undefined) {
      wireSource = discField.source;
    } else if (discField.source !== wireSource) {
      throw new RangeError(
        `Discriminator "${discriminator}" has inconsistent external sources: "${wireSource}" and "${discField.source}"`,
      );
    }

    const tags = getStaticLiterals(discField.codec);
    if (!tags || tags.length === 0) {
      throw new TypeError(`Discriminator field "${discriminator}" must use literal() or oneOf()`);
    }

    for (const tag of tags) {
      if (tag === undefined) {
        throw new TypeError(`Discriminator field "${discriminator}" cannot use undefined as a tag`);
      }
      if (branchByTag.has(tag)) {
        throw new RangeError(
          `Duplicate discriminator tag ${formatLiteral(tag)} for "${discriminator}"`,
        );
      }
      branchByTag.set(tag, branch);
    }
  }

  const externalKey = wireSource as string;
  const expectedTagsText = [...branchByTag.keys()].map(formatLiteral).join(", ");

  type UnionModel = InferValue<Branches[number]>;
  type UnionDTO = InferEncoded<Branches[number]>;

  return createCodec<UnionModel, UnionDTO>((input, direction, collector) => {
    if (direction === "decode") {
      if (!isPlainObject(input)) {
        return collector.add("type.object", "Expected a plain object");
      }
      if (!Object.hasOwn(input, externalKey)) {
        collector.pushSegment(externalKey);
        collector.add("field.required", `Missing required field: ${externalKey}`);
        collector.popSegment();
        return INVALID;
      }

      const rawTag = input[externalKey];
      const branch = branchByTag.get(rawTag as FieldLiteral);
      if (!branch) {
        collector.pushSegment(externalKey);
        collector.add(
          "union.invalid_tag",
          `Expected discriminator "${externalKey}" to be one of: ${expectedTagsText}`,
        );
        collector.popSegment();
        return INVALID;
      }
      return executeCodec(branch, input, "decode", collector) as UnionModel;
    }

    if (!isObject(input)) {
      return collector.add("type.object", "Expected a model object");
    }
    const modelTag = readModelField(input, discriminator);
    if (modelTag === missingField) {
      collector.pushSegment(discriminator);
      collector.add("field.required", `Missing model field: ${discriminator}`);
      collector.popSegment();
      return INVALID;
    }

    const branch = branchByTag.get(modelTag as FieldLiteral);
    if (!branch) {
      collector.pushSegment(discriminator);
      collector.add(
        "union.invalid_tag",
        `Expected discriminator "${discriminator}" to be one of: ${expectedTagsText}`,
      );
      collector.popSegment();
      return INVALID;
    }
    return executeCodec(branch, input, "encode", collector) as UnionDTO;
  });
}
