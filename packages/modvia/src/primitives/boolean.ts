import { defineCodec } from "../codec/core/define.ts";
import { createCodec, extendCodec } from "../codec/core/runtime.ts";
import type { Codec, WithCodecTrait } from "../codec/core/types.ts";
import {
  compileBooleanTokens,
  formatBooleanToken,
  parseBooleanToken,
  type BooleanTokenTable,
} from "../scalars/boolean.ts";

/** 布尔文本编解码器自有链式方法特征 */
export interface BooleanStringTrait {
  /** 自定义真值与假值候选词列表，编码端统一收敛至各自首个词 */
  tokens(truthy: readonly [string, ...string[]], falsy: readonly [string, ...string[]]): unknown;
  /** 开启大小写精确敏感匹配（默认不区分大小写） */
  caseSensitive(): unknown;
}

/** 布尔文本双向编解码器（string ↔ boolean），支持自定义真假词表与大小写敏感链式派生 */
export type BooleanStringCodec = WithCodecTrait<boolean, string, BooleanStringTrait>;

/** 原生布尔值双向编解码器（boolean ↔ boolean），可通过 .fromString() 切换为字符串传输介质 */
export interface BooleanCodec extends Codec<boolean, boolean> {
  /** 切换外部编码表示为布尔字符串（string ↔ boolean，默认大小写不敏感匹配 "true" / "false"） */
  fromString(this: void): BooleanStringCodec;
  /** 为当前布尔编解码器附加静态文档说明文本，保留 .fromString() 方法 */
  describe(this: void, description: string): BooleanCodec;
}

const defaultBooleanStringCodec: BooleanStringCodec = defineCodec({
  state: compileBooleanTokens(["true"], ["false"], false),
  decode(input, ctx) {
    if (typeof input !== "string") {
      return ctx.fail("type.string", "Expected a string");
    }
    const parsed = parseBooleanToken(input, ctx.state);
    if (parsed === null) {
      return ctx.fail("format.boolean_string", "Expected a valid boolean string");
    }
    return parsed;
  },
  encode(input, ctx) {
    if (typeof input !== "boolean") {
      return ctx.fail("type.boolean", "Expected a boolean");
    }
    return formatBooleanToken(input, ctx.state);
  },
  meta: (state) => ({
    format: "boolean-string",
    encodedSchema: state.caseSensitive
      ? { type: "string", enum: [...state.truthySet, ...state.falsySet] }
      : { type: "string" },
    decodedSchema: { type: "boolean" },
  }),
  methods: {
    tokens:
      (truthy: readonly [string, ...string[]], falsy: readonly [string, ...string[]]) =>
      (prev: Readonly<BooleanTokenTable>) =>
        compileBooleanTokens(truthy, falsy, prev.caseSensitive),
    caseSensitive: () => (prev: Readonly<BooleanTokenTable>) =>
      compileBooleanTokens(prev.rawTruthy, prev.rawFalsy, true),
  },
});

function buildNativeBooleanCodec(description?: string): BooleanCodec {
  const base = createCodec<boolean, boolean>(
    (input, _direction, collector) => {
      if (typeof input !== "boolean") {
        return collector.add("type.boolean", "Expected a boolean");
      }
      return input;
    },
    {
      descriptor: {
        kind: "boolean",
        ...(description !== undefined ? { description } : {}),
      },
    },
  );

  return extendCodec(base, {
    fromString(): BooleanStringCodec {
      return description !== undefined
        ? defaultBooleanStringCodec.describe(description)
        : defaultBooleanStringCodec;
    },
    describe(nextDescription: string): BooleanCodec {
      if (typeof nextDescription !== "string") {
        throw new TypeError("Description must be a string");
      }
      return buildNativeBooleanCodec(nextDescription);
    },
  });
}

const defaultBooleanCodec: BooleanCodec = buildNativeBooleanCodec();

/** 布尔值双向编解码器，可通过 .fromString() 切换至字符串传输表示 */
export function boolean(): BooleanCodec {
  return defaultBooleanCodec;
}
