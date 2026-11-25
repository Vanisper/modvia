import { defineCodec } from "../../codec/core/define.ts";
import type { StatefulCodecContext, WithCodecTrait } from "../../codec/core/types.ts";

/** URL 编解码器自有链式方法特征 */
export interface UrlTrait {
  /** 限制允许的协议白名单（如 .protocols("https", "http") 或 "https:"） */
  protocols(...allowed: readonly [string, ...string[]]): unknown;
  /** 仅允许 https 协议（等价于 .protocols("https")） */
  https(): unknown;
}

/** 标准 URL 双向编解码器，支持协议白名单与 HTTPS 约束链式派生 */
export type UrlCodec = WithCodecTrait<string, string, UrlTrait>;

interface UrlState {
  readonly allowedProtocols?: ReadonlySet<string>;
}

interface GlobalUrlConstructor {
  new (input: string): { readonly protocol: string; readonly hostname: string };
}

const authorityProtocols = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);

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

function validateUrl(input: unknown, ctx: StatefulCodecContext<UrlState>): string {
  if (typeof input !== "string") {
    return ctx.fail("type.string", "Expected a string");
  }
  const UrlCtor = (globalThis as { readonly URL?: GlobalUrlConstructor }).URL;
  if (!UrlCtor) {
    throw new Error("Global URL constructor is not available in this runtime");
  }
  if (input.length === 0 || /\s/.test(input)) {
    return ctx.fail("format.url", "Expected a valid URL");
  }
  let parsed: { readonly protocol: string; readonly hostname: string };
  try {
    parsed = new UrlCtor(input);
  } catch {
    return ctx.fail("format.url", "Expected a valid URL");
  }
  const protocol = parsed.protocol.toLowerCase();
  const afterProtocol = input.slice(parsed.protocol.length);
  if (
    authorityProtocols.has(protocol) &&
    (!afterProtocol.startsWith("//") || afterProtocol[2] === "/" || parsed.hostname.length === 0)
  ) {
    return ctx.fail("format.url", "Expected a valid URL");
  }
  if (ctx.state.allowedProtocols !== undefined && !ctx.state.allowedProtocols.has(protocol)) {
    return ctx.fail("format.url_protocol", `URL protocol "${parsed.protocol}" is not allowed`);
  }
  return input;
}

const uriSchema = Object.freeze({ type: "string", format: "uri" });

const defaultUrlCodec: UrlCodec = defineCodec({
  state: {} as UrlState,
  decode: validateUrl,
  encode: validateUrl,
  descriptor: {
    kind: "custom",
    format: "uri",
    encodedSchema: uriSchema,
    decodedSchema: uriSchema,
  },
  methods: {
    protocols: (...allowed: readonly [string, ...string[]]) => ({
      allowedProtocols: normalizeProtocols(allowed),
    }),
    https: () => ({
      allowedProtocols: normalizeProtocols(["https"]),
    }),
  },
});

/** 标准 URL 双向编解码器，可通过 .protocols(...) 或 .https() 链式限制协议 */
export function url(): UrlCodec {
  return defaultUrlCodec;
}
