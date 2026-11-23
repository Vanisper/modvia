import { defineCodec } from "../codec/core/define.ts";
import type { Codec } from "../codec/core/types.ts";

export interface EmailOptions {
  readonly trim?: boolean;
  readonly lowercase?: boolean;
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const emailPattern =
  /^(?!\.)(?!.*\.\.)([a-zA-Z0-9_'+\-.]*)[a-zA-Z0-9_+-]@([a-zA-Z0-9][a-zA-Z0-9-]*\.)+[a-zA-Z]{2,}$/;

/**
 * 标准 UUID（RFC 9562 / 4122）双向编解码器
 *
 * @description 解码与编码两端均归一为全小写十六进制形态，满足往返收敛律
 */
export function uuid(): Codec<string, string> {
  return defineCodec<string, string>({
    decode: validateUuid,
    encode: validateUuid,
    meta: {
      format: "uuid",
      encodedSchema: { type: "string", format: "uuid" },
    },
  });
}

function validateUuid(
  input: unknown,
  context: { fail(code: string, message: string): never },
): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!uuidPattern.test(input)) {
    return context.fail("format.uuid", "Expected a valid UUID");
  }
  return input.toLowerCase();
}

/** 电子邮箱地址双向编解码器，可选对称裁剪空白与小写归一化 */
export function email(options: EmailOptions = {}): Codec<string, string> {
  const trim = Boolean(options.trim);
  const lowercase = Boolean(options.lowercase);

  const run = (input: unknown, context: { fail(code: string, message: string): never }): string => {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    let normalized = trim ? input.trim() : input;
    if (lowercase) {
      normalized = normalized.toLowerCase();
    }
    if (normalized.length > 254 || !emailPattern.test(normalized)) {
      return context.fail("format.email", "Expected a valid email address");
    }
    return normalized;
  };

  return defineCodec<string, string>({
    decode: run,
    encode: run,
    meta: {
      format: "email",
      encodedSchema: { type: "string", format: "email", maxLength: 254 },
    },
  });
}
