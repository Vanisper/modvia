import type { Invalid, IssueCollector } from "../../codec/core/collector.ts";
import { createStatefulCodec, type InternalRunner } from "../../codec/core/runtime.ts";
import type { CodecDescriptor } from "../../codec/core/types.ts";
import { checkOrderedBounds, type OrderedBounds } from "../../scalars/bounds/ordered.ts";

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

export interface OrderedScalarAdapter<N extends number | bigint> {
  readonly zero: N;
  readonly noun: string;
  readonly errorDomain: "number" | "bigint";
  readonly nativeTypeCode: string;
  readonly nativeTypeMessage: string;
  readonly stringFormatCode: string;
  readonly stringFormatMessage: string;
  readonly stringWireFormat: string;
  readonly stringEncodedSchema: Readonly<Record<string, unknown>>;
  readonly isNative: (value: unknown) => value is N;
  readonly assertBound: (value: N, label: string) => void;
  readonly validateBounds: (bounds: Readonly<OrderedBounds<N>>) => void;
  readonly parseFromString: (input: string) => N | null;
  readonly formatToString: (value: N) => string;
  readonly buildNativeDescriptor: (
    bounds: Readonly<OrderedBounds<N>>,
    description?: string,
  ) => CodecDescriptor;
  readonly buildDecodedJsonSchema?: (
    bounds: Readonly<OrderedBounds<N>>,
  ) => Readonly<Record<string, unknown>>;
}

export function createOrderedScalarCodec<N extends number | bigint, ResultCodec>(
  adapter: OrderedScalarAdapter<N>,
): ResultCodec {
  const methods = {
    min: (min: N) => {
      adapter.assertBound(min, "min");
      return { lower: { value: min, exclusive: false } };
    },
    max: (max: N) => {
      adapter.assertBound(max, "max");
      return { upper: { value: max, exclusive: false } };
    },
    gt: (bound: N) => {
      adapter.assertBound(bound, "gt");
      return { lower: { value: bound, exclusive: true } };
    },
    lt: (bound: N) => {
      adapter.assertBound(bound, "lt");
      return { upper: { value: bound, exclusive: true } };
    },
    positive: () => ({ lower: { value: adapter.zero, exclusive: true } }),
    nonNegative: () => ({ lower: { value: adapter.zero, exclusive: false } }),
    negative: () => ({ upper: { value: adapter.zero, exclusive: true } }),
    nonPositive: () => ({ upper: { value: adapter.zero, exclusive: false } }),
  };

  const buildStringCodec = (bounds: Readonly<OrderedBounds<N>>, description?: string) =>
    createStatefulCodec({
      state: { ...bounds } as OrderedBounds<N>,
      description,
      validate: adapter.validateBounds,
      createRunner(state): InternalRunner<N, string> {
        return (input, direction, collector) => {
          if (direction === "decode") {
            if (typeof input !== "string") {
              return collector.add("type.string", "Expected a string");
            }
            const parsed = adapter.parseFromString(input);
            if (parsed === null) {
              return collector.add(adapter.stringFormatCode, adapter.stringFormatMessage);
            }
            const violation = checkOrderedBounds(parsed, state);
            if (violation !== undefined) {
              return reportBoundViolation(violation, state, adapter, collector);
            }
            return parsed;
          }

          if (!adapter.isNative(input)) {
            return collector.add(adapter.nativeTypeCode, adapter.nativeTypeMessage);
          }
          const violation = checkOrderedBounds(input, state);
          if (violation !== undefined) {
            return reportBoundViolation(violation, state, adapter, collector);
          }
          return adapter.formatToString(input);
        };
      },
      createDescriptor(state, desc) {
        const decodedSchema = adapter.buildDecodedJsonSchema?.(state);
        return {
          kind: "custom",
          format: adapter.stringWireFormat,
          encodedSchema: adapter.stringEncodedSchema,
          ...(decodedSchema !== undefined ? { decodedSchema } : {}),
          ...(desc !== undefined ? { description: desc } : {}),
        };
      },
      methods,
    });

  return createStatefulCodec({
    state: {} as OrderedBounds<N>,
    validate: adapter.validateBounds,
    createRunner(state): InternalRunner<N, N> {
      return (input, _direction, collector) => {
        if (!adapter.isNative(input)) {
          return collector.add(adapter.nativeTypeCode, adapter.nativeTypeMessage);
        }
        const violation = checkOrderedBounds(input, state);
        if (violation !== undefined) {
          return reportBoundViolation(violation, state, adapter, collector);
        }
        return input;
      };
    },
    createDescriptor(state, description) {
      return adapter.buildNativeDescriptor(state, description);
    },
    methods,
    extraMethods: (state, description) => ({
      fromString: () => buildStringCodec(state, description),
    }),
  }) as unknown as ResultCodec;
}

function reportBoundViolation<N extends number | bigint>(
  violation: "min" | "max" | "gt" | "lt",
  state: Readonly<OrderedBounds<N>>,
  adapter: OrderedScalarAdapter<N>,
  collector: IssueCollector,
): Invalid {
  switch (violation) {
    case "min":
      return collector.add(
        `${adapter.errorDomain}.min`,
        `Expected ${adapter.noun} >= ${state.lower?.value}`,
      );
    case "gt":
      return collector.add(
        `${adapter.errorDomain}.gt`,
        `Expected ${adapter.noun} > ${state.lower?.value}`,
      );
    case "max":
      return collector.add(
        `${adapter.errorDomain}.max`,
        `Expected ${adapter.noun} <= ${state.upper?.value}`,
      );
    case "lt":
      return collector.add(
        `${adapter.errorDomain}.lt`,
        `Expected ${adapter.noun} < ${state.upper?.value}`,
      );
  }
}

export function buildNumericJsonBounds(
  type: "number" | "integer",
  bounds: Readonly<OrderedBounds<number>>,
): Readonly<Record<string, unknown>> {
  const { lower, upper } = bounds;
  return {
    type,
    ...(lower !== undefined
      ? lower.exclusive
        ? { exclusiveMinimum: lower.value }
        : { minimum: lower.value }
      : {}),
    ...(upper !== undefined
      ? upper.exclusive
        ? { exclusiveMaximum: upper.value }
        : { maximum: upper.value }
      : {}),
  };
}
