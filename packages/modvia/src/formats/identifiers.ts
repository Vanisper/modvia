import { defineCodec } from "../codec/core/define.ts";
import type { Codec, CodecContext } from "../codec/core/types.ts";

/** 电子邮箱双向编解码器，支持对称空白裁剪与小写规范化链式派生 */
export interface EmailCodec extends Codec<string, string> {
  /** 对称去除邮箱字符串首尾空白 */
  trim(this: void): EmailCodec;
  /** 对称将邮箱地址归一化为全小写形态 */
  lowercase(this: void): EmailCodec;
  /** 为当前邮箱编解码器附加静态文档说明文本，保留全部邮箱自有方法 */
  describe(this: void, description: string): EmailCodec;
}

interface EmailState {
  readonly trim: boolean;
  readonly lowercase: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern =
  /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;

const defaultUuidCodec: Codec<string, string> = defineCodec<string, string>({
  decode: validateUuid,
  encode: validateUuid,
  meta: {
    format: "uuid",
    encodedSchema: { type: "string", format: "uuid" },
  },
});

function validateUuid(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!uuidPattern.test(input)) {
    return context.fail("format.uuid", "Expected a valid UUID");
  }
  return input.toLowerCase();
}

function validateEmail(input: unknown, context: CodecContext, state: Readonly<EmailState>): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  let normalized = state.trim ? input.trim() : input;
  if (state.lowercase) {
    normalized = normalized.toLowerCase();
  }
  if (normalized.length > 254 || !emailPattern.test(normalized)) {
    return context.fail("format.email", "Expected a valid email address");
  }
  return normalized;
}

const defaultEmailCodec: EmailCodec = defineCodec({
  state: { trim: false, lowercase: false } as EmailState,
  decode: validateEmail,
  encode: validateEmail,
  meta: {
    format: "email",
    encodedSchema: { type: "string", format: "email", maxLength: 254 },
  },
  methods: {
    trim: (state): EmailState => ({ ...state, trim: true }),
    lowercase: (state): EmailState => ({ ...state, lowercase: true }),
  },
});

/**
 * 标准 UUID（RFC 9562 / 4122）双向编解码器
 *
 * @description 解码与编码两端均归一为全小写十六进制形态，满足往返收敛律
 */
export function uuid(): Codec<string, string> {
  return defaultUuidCodec;
}

/** 电子邮箱地址双向编解码器，可通过 .trim() 与 .lowercase() 链式派生 */
export function email(): EmailCodec {
  return defaultEmailCodec;
}
