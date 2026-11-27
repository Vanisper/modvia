import { promoteToCodec } from "../../codec/core/codec.ts";
import { defineCodec } from "../../codec/core/define.ts";
import { compact } from "../../codec/core/descriptor.ts";
import { builtinIssues, type BuiltinIssue } from "../../codec/core/issues.ts";
import { createFamily } from "../../codec/core/trait.ts";
import type {
  CodecDescriptor,
  Failed,
  StatefulCodecContext,
  WithCodecTrait,
} from "../../codec/core/types.ts";
import {
  checkOrderedBounds,
  type OrderedBounds,
  type OrderedViolation,
} from "../../scalars/bounds/ordered.ts";

/** 有序数值编解码器通用的区间与正负号链式方法特征 */
export interface OrderedNumericTrait<N extends number | bigint> {
  /** 限制闭区间最小下界（value >= min） */
  min(min: N): unknown;
  /** 限制闭区间最大上界（value <= max） */
  max(max: N): unknown;
  /** 限制开区间严格下界（value > bound） */
  gt(bound: N): unknown;
  /** 限制开区间严格上界（value < bound） */
  lt(bound: N): unknown;
  /** 要求严格正值（value > 0） */
  positive(): unknown;
  /** 要求非负值（value >= 0） */
  nonNegative(): unknown;
  /** 要求严格负值（value < 0） */
  negative(): unknown;
  /** 要求非正值（value <= 0） */
  nonPositive(): unknown;
}

/** 原生介质根实例专属的派生方法 */
export interface OrderedNumericRoot<N extends number | bigint> {
  /** 切换外部编码表示为十进制数值字符串（string ↔ N），保留全部已声明及后续追加的区间约束 */
  fromString(): OrderedNumericCodec<N, string>;
}

/** 有序数值双向编解码器：原生介质根实例可经 .fromString() 接入十进制文本上游，此后外部表示为 string */
export type OrderedNumericCodec<N extends number | bigint, Encoded = N> = [Encoded] extends [N]
  ? WithCodecTrait<N, N, OrderedNumericTrait<N>, OrderedNumericRoot<N>>
  : WithCodecTrait<N, Encoded, OrderedNumericTrait<N>>;

/** 有序数值领域：原生类型守卫、区间代数、十进制文本规则与对应目录问题工厂 */
export interface OrderedNumericDomain<N extends number | bigint> {
  readonly kind: "number" | "integer" | "bigint";
  readonly zero: N;
  readonly isNative: (value: unknown) => value is N;
  readonly assertBound: (value: N, label: string) => void;
  readonly validateBounds: (bounds: Readonly<OrderedBounds<N>>) => void;
  readonly parseText: (input: string) => N | null;
  readonly formatText: (value: N) => string;
  readonly issues: {
    readonly type: () => BuiltinIssue;
    readonly format: () => BuiltinIssue;
    readonly bound: (violation: OrderedViolation, limit: N) => BuiltinIssue;
  };
}

/** 构造有序数值族：原生介质根实例 + 十进制文本上游（.fromString() 即把文本 Codec 接入上游槽） */
export function createOrderedNumericCodec<N extends number | bigint>(
  domain: OrderedNumericDomain<N>,
): OrderedNumericCodec<N> {
  const decimalText = promoteToCodec(
    defineCodec<N, string>({
      decode(input, context) {
        if (typeof input !== "string") return context.issue(builtinIssues.typeString());
        const parsed = domain.parseText(input);
        return parsed === null ? context.issue(domain.issues.format()) : parsed;
      },
      encode: (input, context) =>
        domain.isNative(input) ? domain.formatText(input) : context.issue(domain.issues.type()),
      descriptor: { kind: "numericString", numericKind: domain.kind },
    }),
  );

  function convertNative(
    input: unknown,
    context: StatefulCodecContext<OrderedBounds<N>>,
  ): N | Failed {
    if (!domain.isNative(input)) return context.issue(domain.issues.type());
    const bounds = context.state;
    const violation = checkOrderedBounds(input, bounds);
    if (violation === undefined) return input;
    const limit =
      violation === "min" || violation === "gt" ? bounds.lower!.value : bounds.upper!.value;
    return context.issue(domain.issues.bound(violation, limit));
  }

  return createFamily<OrderedBounds<N>>({
    state: {},
    validate: domain.validateBounds,
    decode: convertNative,
    encode: convertNative,
    descriptor: (bounds) => orderedDescriptor(domain.kind, bounds),
    methods: {
      min: (min: N) => {
        domain.assertBound(min, "min");
        return { lower: { value: min, exclusive: false } };
      },
      max: (max: N) => {
        domain.assertBound(max, "max");
        return { upper: { value: max, exclusive: false } };
      },
      gt: (bound: N) => {
        domain.assertBound(bound, "gt");
        return { lower: { value: bound, exclusive: true } };
      },
      lt: (bound: N) => {
        domain.assertBound(bound, "lt");
        return { upper: { value: bound, exclusive: true } };
      },
      positive: () => ({ lower: { value: domain.zero, exclusive: true } }),
      nonNegative: () => ({ lower: { value: domain.zero, exclusive: false } }),
      negative: () => ({ upper: { value: domain.zero, exclusive: true } }),
      nonPositive: () => ({ upper: { value: domain.zero, exclusive: false } }),
    },
    derive: {
      fromString: (self) => decimalText.pipe(self),
    },
  })() as unknown as OrderedNumericCodec<N>;
}

function orderedDescriptor<N extends number | bigint>(
  kind: OrderedNumericDomain<N>["kind"],
  { lower, upper }: Readonly<OrderedBounds<N>>,
): CodecDescriptor {
  return compact({
    kind,
    min: lower?.exclusive === false ? lower.value : undefined,
    exclusiveMin: lower?.exclusive === true ? lower.value : undefined,
    max: upper?.exclusive === false ? upper.value : undefined,
    exclusiveMax: upper?.exclusive === true ? upper.value : undefined,
  }) as CodecDescriptor;
}
