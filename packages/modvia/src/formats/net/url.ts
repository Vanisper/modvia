import { defineCodec } from "../../codec/core/define.ts";
import { compact } from "../../codec/core/descriptor.ts";
import { builtinIssues } from "../../codec/core/issues.ts";
import type { Failed, StatefulCodecContext, WithCodecTrait } from "../../codec/core/types.ts";

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
  readonly allowedProtocols?: readonly string[];
  readonly allowedSet?: ReadonlySet<string>;
}

interface GlobalUrlConstructor {
  new (input: string): { readonly protocol: string; readonly hostname: string };
}

const authorityProtocols = new Set(["http:", "https:", "ws:", "wss:", "ftp:"]);

function normalizeProtocols(rawList: readonly string[]): {
  readonly allowedProtocols: readonly string[];
  readonly allowedSet: ReadonlySet<string>;
} {
  if (!Array.isArray(rawList) || rawList.length === 0) {
    throw new RangeError("protocols requires at least one protocol name");
  }
  const normalized = rawList.map((entry) => {
    if (typeof entry !== "string" || entry.length === 0) {
      throw new TypeError("Each protocol must be a non-empty string");
    }
    const lower = entry.toLowerCase();
    return lower.endsWith(":") ? lower : `${lower}:`;
  });
  const allowedSet = new Set(normalized);
  return { allowedProtocols: Object.freeze([...allowedSet]), allowedSet };
}

function validateUrl(input: unknown, ctx: StatefulCodecContext<UrlState>): string | Failed {
  if (typeof input !== "string") {
    return ctx.issue(builtinIssues.typeString());
  }
  const UrlCtor = (globalThis as { readonly URL?: GlobalUrlConstructor }).URL;
  if (!UrlCtor) {
    throw new Error("Global URL constructor is not available in this runtime");
  }
  if (input.length === 0 || /\s/.test(input)) {
    return ctx.issue(builtinIssues.formatUrl());
  }
  let parsed: { readonly protocol: string; readonly hostname: string };
  try {
    parsed = new UrlCtor(input);
  } catch {
    return ctx.issue(builtinIssues.formatUrl());
  }
  const protocol = parsed.protocol.toLowerCase();
  const afterProtocol = input.slice(parsed.protocol.length);
  if (
    authorityProtocols.has(protocol) &&
    (!afterProtocol.startsWith("//") || afterProtocol[2] === "/" || parsed.hostname.length === 0)
  ) {
    return ctx.issue(builtinIssues.formatUrl());
  }
  if (ctx.state.allowedSet !== undefined && !ctx.state.allowedSet.has(protocol)) {
    return ctx.issue(builtinIssues.urlProtocol(parsed.protocol, ctx.state.allowedProtocols!));
  }
  return input;
}

const defaultUrlCodec: UrlCodec = defineCodec({
  state: {} as UrlState,
  decode: validateUrl,
  encode: validateUrl,
  descriptor: (state) =>
    compact({
      kind: "string" as const,
      format: "uri" as const,
      protocols: state.allowedProtocols,
    }),
  methods: {
    protocols: (...allowed: readonly [string, ...string[]]) => normalizeProtocols(allowed),
    https: () => normalizeProtocols(["https"]),
  },
});

/** 标准 URL 双向编解码器，可通过 .protocols(...) 或 .https() 链式限制协议 */
export function url(): UrlCodec {
  return defaultUrlCodec;
}
