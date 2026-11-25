import { createCodec, promoteToCodec } from "../../codec/core/codec.ts";
import { staticLiterals } from "../../codec/core/descriptor.ts";
import { descriptorOf, kernelOf, type Kernel } from "../../codec/core/internals.ts";
import type { Codec, FieldLiteral, InferEncoded, InferValue } from "../../codec/core/types.ts";
import { isObject, isPlainObject } from "../../shared/object.ts";
import { formatLiteral } from "../../shared/value.ts";
import { missingField, readModelField, resolveFields } from "../core/fields.ts";
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

  let externalKey: string | undefined;
  const branchByTag = new Map<FieldLiteral, Kernel>();

  for (const branch of branches) {
    const descriptor = descriptorOf(branch);
    if (descriptor.kind !== "model") {
      throw new TypeError("taggedUnion branches must be models created with Model.define");
    }
    const tagField = resolveFields(descriptor.fields).find((field) => field.key === discriminator);
    if (tagField === undefined) {
      throw new RangeError(`Branch model is missing discriminator field "${discriminator}"`);
    }
    if (tagField.presence !== "required") {
      throw new RangeError(
        `Discriminator field "${discriminator}" must be required in every branch`,
      );
    }
    if (externalKey === undefined) {
      externalKey = tagField.source;
    } else if (tagField.source !== externalKey) {
      throw new RangeError(
        `Discriminator "${discriminator}" has inconsistent external sources: "${externalKey}" and "${tagField.source}"`,
      );
    }

    const tags = staticLiterals(tagField.codec);
    if (tags === undefined || tags.length === 0) {
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
      branchByTag.set(tag, kernelOf(branch));
    }
  }

  const wireKey = externalKey as string;
  const expectedTags = [...branchByTag.keys()].map(formatLiteral).join(", ");

  const kernel: Kernel = {
    decode(input, collector) {
      if (!isPlainObject(input)) {
        return collector.add("type.object", "Expected a plain object");
      }
      if (!Object.hasOwn(input, wireKey)) {
        return collector.addAtSegment(
          wireKey,
          "field.required",
          `Missing required field: ${wireKey}`,
        );
      }
      const branch = branchByTag.get(input[wireKey] as FieldLiteral);
      if (branch === undefined) {
        return collector.addAtSegment(
          wireKey,
          "union.invalid_tag",
          `Expected discriminator "${wireKey}" to be one of: ${expectedTags}`,
        );
      }
      return branch.decode(input, collector);
    },
    encode(input, collector) {
      if (!isObject(input)) {
        return collector.add("type.object", "Expected a model object");
      }
      const tag = readModelField(input, discriminator);
      if (tag === missingField) {
        return collector.addAtSegment(
          discriminator,
          "field.required",
          `Missing model field: ${discriminator}`,
        );
      }
      const branch = branchByTag.get(tag as FieldLiteral);
      if (branch === undefined) {
        return collector.addAtSegment(
          discriminator,
          "union.invalid_tag",
          `Expected discriminator "${discriminator}" to be one of: ${expectedTags}`,
        );
      }
      return branch.encode(input, collector);
    },
  };

  return createCodec(kernel, {
    kind: "taggedUnion",
    discriminator,
    externalKey: wireKey,
    branches: Object.freeze(branches.map((branch) => promoteToCodec(branch))),
  }) as unknown as Codec<InferValue<Branches[number]>, InferEncoded<Branches[number]>>;
}
