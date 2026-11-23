import { defineCodec } from "../codec/core/define.ts";
import type { Codec, CodecContext } from "../codec/core/types.ts";

/** 标准 URL 双向编解码器，支持协议白名单与 HTTPS 约束链式派生 */
export interface UrlCodec extends Codec<string, string> {
  /** 限制允许的协议白名单（如 .protocols("https", "http") 或 "https:"） */
  protocols(this: void, ...allowed: readonly [string, ...string[]]): UrlCodec;
  /** 仅允许 https 协议（等价于 .protocols("https")） */
  https(this: void): UrlCodec;
  /** 为当前 URL 编解码器附加静态文档说明文本，保留全部 URL 自有方法 */
  describe(this: void, description: string): UrlCodec;
}

interface UrlState {
  readonly allowedProtocols?: ReadonlySet<string>;
}

interface GlobalUrlConstructor {
  new (input: string): { readonly protocol: string };
}

function normalizeProtocols(rawList: readonly string[]): ReadonlySet<string> {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new RangeError("protocols requires at least one protocol name");
  }
  return new Set(
    rawList.map((entry) => {
      if (typeof entry !== "string" || entry.length === 0) {
        throw new TypeError("Each protocol must be a non-empty string");
      }
      const lower = entry.toLowerCase();
      return lower.endsWith(":") ? lower : `${lower}:`;
    }),
  );
}

function validateUrl(input: unknown, context: CodecContext, state: Readonly<UrlState>): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  const UrlCtor = (globalThis as { readonly URL?: GlobalUrlConstructor }).URL;
  if (input.length === 0 || /\s/.test(input) || !UrlCtor) {
    return context.fail("format.url", "Expected a valid URL");
  }
  let parsed: { readonly protocol: string };
  try {
    parsed = new UrlCtor(input);
  } catch {
    return context.fail("format.url", "Expected a valid URL");
  }
  if (
    state.allowedProtocols !== undefined &&
    !state.allowedProtocols.has(parsed.protocol.toLowerCase())
  ) {
    return context.fail("format.url_protocol", `URL protocol "${parsed.protocol}" is not allowed`);
  }
  return input;
}

const defaultUrlCodec: UrlCodec = defineCodec({
  state: {} as UrlState,
  decode: validateUrl,
  encode: validateUrl,
  meta: {
    format: "uri",
    encodedSchema: { type: "string", format: "uri" },
  },
  methods: {
    protocols: (state, ...allowed: readonly [string, ...string[]]): UrlState => ({
      ...state,
      allowedProtocols: normalizeProtocols(allowed),
    }),
    https: (state): UrlState => ({
      ...state,
      allowedProtocols: normalizeProtocols(["https"]),
    }),
  },
});

const defaultIpv4Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv4,
  encode: validateIpv4,
  meta: {
    format: "ipv4",
    encodedSchema: { type: "string", format: "ipv4" },
  },
});

const defaultIpv6Codec: Codec<string, string> = defineCodec<string, string>({
  decode: validateIpv6,
  encode: validateIpv6,
  meta: {
    format: "ipv6",
    encodedSchema: { type: "string", format: "ipv6" },
  },
});

/** 标准 URL 双向编解码器，可通过 .protocols(...) 或 .https() 链式限制协议 */
export function url(): UrlCodec {
  return defaultUrlCodec;
}

/** IPv4 点分十进制地址双向编解码器（拒绝前导零） */
export function ipv4(): Codec<string, string> {
  return defaultIpv4Codec;
}

/** IPv6（RFC 4291）地址双向编解码器，支持零压缩与内嵌 IPv4 尾部 */
export function ipv6(): Codec<string, string> {
  return defaultIpv6Codec;
}

function validateIpv4(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!isValidIpv4(input)) {
    return context.fail("format.ipv4", "Expected a valid IPv4 address");
  }
  return input;
}

function validateIpv6(input: unknown, context: CodecContext): string {
  if (typeof input !== "string") {
    return context.fail("type.string", "Expected a string");
  }
  if (!isValidIpv6(input)) {
    return context.fail("format.ipv6", "Expected a valid IPv6 address");
  }
  return input;
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
