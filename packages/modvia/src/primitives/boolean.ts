import { builtinIssues } from "../codec/core/issues.ts";
import { createFamily } from "../codec/core/trait.ts";
import type { CodecContext, Failed, WithCodecTrait } from "../codec/core/types.ts";
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
export type BooleanCodec = WithCodecTrait<
  boolean,
  boolean,
  Record<never, never>,
  {
    /** 切换外部编码表示为布尔字符串（string ↔ boolean，默认大小写不敏感匹配 "true" / "false"） */
    fromString(): BooleanStringCodec;
  }
>;

const defaultBooleanStringCodec = createFamily<BooleanTokenTable>({
  state: compileBooleanTokens(["true"], ["false"], false),
  decode(input, context) {
    if (typeof input !== "string") {
      return context.issue(builtinIssues.typeString());
    }
    const parsed = parseBooleanToken(input, context.state);
    if (parsed === null) {
      return context.issue(
        builtinIssues.formatBooleanString(context.state.rawTruthy, context.state.rawFalsy),
      );
    }
    return parsed;
  },
  encode(input, context) {
    if (typeof input !== "boolean") {
      return context.issue(builtinIssues.typeBoolean());
    }
    return formatBooleanToken(input, context.state);
  },
  descriptor: (state) => ({
    kind: "booleanString",
    truthy: state.rawTruthy,
    falsy: state.rawFalsy,
    caseSensitive: state.caseSensitive,
  }),
  methods: {
    tokens:
      (truthy: readonly [string, ...string[]], falsy: readonly [string, ...string[]]) =>
      (prev: Readonly<BooleanTokenTable>) =>
        compileBooleanTokens(truthy, falsy, prev.caseSensitive),
    caseSensitive: () => (prev: Readonly<BooleanTokenTable>) =>
      compileBooleanTokens(prev.rawTruthy, prev.rawFalsy, true),
  },
})();

function convertBoolean(input: unknown, context: CodecContext): boolean | Failed {
  return typeof input === "boolean" ? input : context.issue(builtinIssues.typeBoolean());
}

const defaultBooleanCodec = createFamily({
  state: {},
  decode: convertBoolean,
  encode: convertBoolean,
  descriptor: { kind: "boolean" },
  derive: {
    fromString: () => defaultBooleanStringCodec,
  },
})() as unknown as BooleanCodec;

/** 布尔值双向编解码器，可通过 .fromString() 切换至字符串传输表示 */
export function boolean(): BooleanCodec {
  return defaultBooleanCodec;
}
