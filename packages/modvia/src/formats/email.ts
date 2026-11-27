import { defineCodec } from "../codec/core/define.ts";
import { builtinIssues } from "../codec/core/issues.ts";
import type { Failed, StatefulCodecContext, WithCodecTrait } from "../codec/core/types.ts";

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

const MAX_EMAIL_LENGTH = 254;
const localPartPattern = /^(?!\.)(?!.*\.\.)[a-zA-Z0-9_'+\-.]*[a-zA-Z0-9_'+-]$/;
const domainPartPattern = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;

function isValidEmailAddress(value: string): boolean {
  if (value.length > MAX_EMAIL_LENGTH) return false;
  const atIndex = value.indexOf("@");
  if (atIndex < 1 || atIndex > 64 || value.indexOf("@", atIndex + 1) !== -1) {
    return false;
  }
  const local = value.slice(0, atIndex);
  const domain = value.slice(atIndex + 1);
  return localPartPattern.test(local) && domainPartPattern.test(domain);
}

function validateEmail(input: unknown, ctx: StatefulCodecContext<EmailState>): string | Failed {
  if (typeof input !== "string") {
    return ctx.issue(builtinIssues.typeString());
  }
  let normalized = ctx.state.trim ? input.trim() : input;
  if (ctx.state.lowercase) {
    normalized = normalized.toLowerCase();
  }
  if (!isValidEmailAddress(normalized)) {
    return ctx.issue(builtinIssues.formatEmail());
  }
  return normalized;
}

const defaultEmailCodec: EmailCodec = defineCodec({
  state: { trim: false, lowercase: false } as EmailState,
  decode: validateEmail,
  encode: validateEmail,
  descriptor: (state) => ({
    kind: "string",
    format: "email",
    trim: state.trim,
    maxLength: MAX_EMAIL_LENGTH,
  }),
  methods: {
    trim: () => ({ trim: true }),
    lowercase: () => ({ lowercase: true }),
  },
});

/** 电子邮箱地址双向编解码器，可通过 .trim() 与 .lowercase() 链式派生 */
export function email(): EmailCodec {
  return defaultEmailCodec;
}
