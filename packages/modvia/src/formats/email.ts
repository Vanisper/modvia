import { defineCodec } from "../codec/core/define.ts";
import type { StatefulCodecContext, WithCodecTrait } from "../codec/core/types.ts";

/** 电子邮箱编解码器自有链式方法特征 */
export interface EmailTrait {
  /** 对称去除邮箱字符串首尾空白 */
  trim(): unknown;
  /** 对称将邮箱地址归一化为全小写形态 */
  lowercase(): unknown;
}

/** 电子邮箱双向编解码器，支持对称空白裁剪与小写规范化链式派生 */
export type EmailCodec = WithCodecTrait<string, string, EmailTrait>;

interface EmailState {
  readonly trim: boolean;
  readonly lowercase: boolean;
}

const emailPattern =
  /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;

function validateEmail(input: unknown, ctx: StatefulCodecContext<EmailState>): string {
  if (typeof input !== "string") {
    return ctx.fail("type.string", "Expected a string");
  }
  let normalized = ctx.state.trim ? input.trim() : input;
  if (ctx.state.lowercase) {
    normalized = normalized.toLowerCase();
  }
  if (normalized.length > 254 || !emailPattern.test(normalized)) {
    return ctx.fail("format.email", "Expected a valid email address");
  }
  return normalized;
}

const emailSchema = Object.freeze({ type: "string", format: "email", maxLength: 254 });

const defaultEmailCodec: EmailCodec = defineCodec({
  state: { trim: false, lowercase: false } as EmailState,
  decode: validateEmail,
  encode: validateEmail,
  meta: {
    format: "email",
    encodedSchema: emailSchema,
    decodedSchema: emailSchema,
  },
  methods: {
    trim: () => ({ trim: true }),
    lowercase: () => ({ lowercase: true }),
  },
});

/** 电子邮箱地址双向编解码器，可通过 .trim() 与 .lowercase() 链式派生 */
export function email(): EmailCodec {
  return defaultEmailCodec;
}
