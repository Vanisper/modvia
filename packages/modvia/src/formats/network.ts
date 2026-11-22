import { defineCodec } from "../codec/core/define.ts";
import type { Codec } from "../codec/core/types.ts";

export interface UrlOptions {
  /** 允许的协议白名单（如 ["https:", "http:"] 或 ["https", "http"]） */
  readonly protocols?: readonly string[];
}

interface GlobalUrlConstructor {
  new (input: string): { readonly protocol: string };
}

/** 标准 URL 双向编解码器，可选限制协议白名单 */
export function url(options: UrlOptions = {}): Codec<string, string> {
  let allowedProtocols: Set<string> | undefined;
  if (options.protocols !== undefined) {
    if (!Array.isArray(options.protocols) || options.protocols.length === 0) {
      throw new RangeError("protocols must be a non-empty array of protocol names");
    }
    allowedProtocols = new Set(
      options.protocols.map((entry) => {
        if (typeof entry !== "string" || entry.length === 0) {
          throw new TypeError("Each protocol in protocols must be a non-empty string");
        }
        const lower = entry.toLowerCase();
        return lower.endsWith(":") ? lower : `${lower}:`;
      }),
    );
  }

  const UrlCtor = (globalThis as { readonly URL?: GlobalUrlConstructor }).URL;

  const run = (input: unknown, context: { fail(code: string, message: string): never }): string => {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    if (input.length === 0 || /\s/.test(input) || !UrlCtor) {
      return context.fail("format.url", "Expected a valid URL");
    }
    let parsed: { readonly protocol: string };
    try {
      parsed = new UrlCtor(input);
    } catch {
      return context.fail("format.url", "Expected a valid URL");
    }
    if (allowedProtocols !== undefined && !allowedProtocols.has(parsed.protocol.toLowerCase())) {
      return context.fail(
        "format.url_protocol",
        `URL protocol "${parsed.protocol}" is not allowed`,
      );
    }
    return input;
  };

  return defineCodec<string, string>({
    decode: run,
    encode: run,
    meta: {
      format: "uri",
      encodedSchema: { type: "string", format: "uri" },
    },
  });
}

/** IPv4 点分十进制地址双向编解码器（拒绝前导零） */
export function ipv4(): Codec<string, string> {
  const run = (input: unknown, context: { fail(code: string, message: string): never }): string => {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    if (!isValidIpv4(input)) {
      return context.fail("format.ipv4", "Expected a valid IPv4 address");
    }
    return input;
  };

  return defineCodec<string, string>({
    decode: run,
    encode: run,
    meta: {
      format: "ipv4",
      encodedSchema: { type: "string", format: "ipv4" },
    },
  });
}

/** IPv6（RFC 4291）地址双向编解码器，支持零压缩与内嵌 IPv4 尾部 */
export function ipv6(): Codec<string, string> {
  const run = (input: unknown, context: { fail(code: string, message: string): never }): string => {
    if (typeof input !== "string") {
      return context.fail("type.string", "Expected a string");
    }
    if (!isValidIpv6(input)) {
      return context.fail("format.ipv6", "Expected a valid IPv6 address");
    }
    return input;
  };

  return defineCodec<string, string>({
    decode: run,
    encode: run,
    meta: {
      format: "ipv6",
      encodedSchema: { type: "string", format: "ipv6" },
    },
  });
}

function isValidIpv4(value: string): boolean {
  const parts = value.split(".");
  if (parts.length !== 4) return false;
  for (const part of parts) {
    if (!/^(0|[1-9]\d{0,2})$/.test(part)) return false;
    if (Number(part) > 255) return false;
  }
  return true;
}

const h16Pattern = /^[0-9a-fA-F]{1,4}$/;

function isValidIpv6(value: string): boolean {
  if (value.length === 0 || value.includes("%")) return false;
  const halves = value.split("::");
  if (halves.length > 2) return false;

  const leftRaw = halves[0] ?? "";
  const rightRaw = halves[1];

  const leftParts = leftRaw === "" ? [] : leftRaw.split(":");
  const rightParts = rightRaw === undefined || rightRaw === "" ? [] : rightRaw.split(":");
  if (leftRaw === "" && halves.length === 1) return false;

  let trailingIpv4Groups = 0;
  const tailContainer = rightParts.length > 0 ? rightParts : leftParts;
  const lastSegment = tailContainer[tailContainer.length - 1];
  if (lastSegment !== undefined && lastSegment.includes(".")) {
    if (!isValidIpv4(lastSegment)) return false;
    tailContainer.pop();
    trailingIpv4Groups = 2;
  }

  for (const seg of leftParts) {
    if (!h16Pattern.test(seg)) return false;
  }
  for (const seg of rightParts) {
    if (!h16Pattern.test(seg)) return false;
  }

  const totalGroups = leftParts.length + rightParts.length + trailingIpv4Groups;
  return halves.length === 2 ? totalGroups < 8 : totalGroups === 8;
}
