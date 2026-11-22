import type { CodecLike, Field } from "../../codec/core/types.ts";

export type NamingKind = "snake_case" | "kebab-case" | "custom";

export interface NamingStrategy<Kind extends NamingKind = "custom"> {
  readonly kind: Kind;
  mapKey(this: void, key: string): string;
}

type UpperAlpha =
  | "A"
  | "B"
  | "C"
  | "D"
  | "E"
  | "F"
  | "G"
  | "H"
  | "I"
  | "J"
  | "K"
  | "L"
  | "M"
  | "N"
  | "O"
  | "P"
  | "Q"
  | "R"
  | "S"
  | "T"
  | "U"
  | "V"
  | "W"
  | "X"
  | "Y"
  | "Z";

type LowerAlpha = Lowercase<UpperAlpha>;
type LowerOrDigit = LowerAlpha | "0" | "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9";

type DelimitedCase<
  S extends string,
  Delimiter extends string,
  Prev extends string = "",
> = S extends `${infer C}${infer Rest}`
  ? C extends UpperAlpha
    ? Prev extends LowerOrDigit
      ? `${Delimiter}${Lowercase<C>}${DelimitedCase<Rest, Delimiter, C>}`
      : Prev extends UpperAlpha
        ? Rest extends `${infer Next}${string}`
          ? Next extends LowerAlpha
            ? `${Delimiter}${Lowercase<C>}${DelimitedCase<Rest, Delimiter, C>}`
            : `${Lowercase<C>}${DelimitedCase<Rest, Delimiter, C>}`
          : `${Lowercase<C>}${DelimitedCase<Rest, Delimiter, C>}`
        : `${Lowercase<C>}${DelimitedCase<Rest, Delimiter, C>}`
    : `${C}${DelimitedCase<Rest, Delimiter, C>}`
  : "";

export type SnakeCase<S extends string> = string extends S ? string : DelimitedCase<S, "_">;

export type KebabCase<S extends string> = string extends S ? string : DelimitedCase<S, "-">;

export type MapNamedKey<Key extends string, Kind extends NamingKind> = Kind extends "snake_case"
  ? SnakeCase<Key>
  : Kind extends "kebab-case"
    ? KebabCase<Key>
    : string;

type BindFieldSource<Entry, MappedSource extends string> =
  Entry extends Field<infer T, infer E, infer Source, infer Presence>
    ? Source extends string
      ? Entry
      : Field<T, E, MappedSource, Presence>
    : Entry extends CodecLike<infer T, infer E>
      ? Field<T, E, MappedSource, "required">
      : never;

export type ApplyNaming<
  Fields extends Readonly<Record<string, CodecLike<unknown, unknown>>>,
  Kind extends NamingKind,
> = {
  readonly [Key in keyof Fields]: Key extends string
    ? BindFieldSource<Fields[Key], MapNamedKey<Key, Kind>>
    : Fields[Key];
};

/** 将模型属性名按编译期与运行期同步规则转换为 snake_case 外部键名 */
export const snakeCase: NamingStrategy<"snake_case"> = Object.freeze({
  kind: "snake_case",
  mapKey(key: string): string {
    return splitIdentifierWords(key, "_");
  },
});

/** 将模型属性名按编译期与运行期同步规则转换为 kebab-case 外部键名 */
export const kebabCase: NamingStrategy<"kebab-case"> = Object.freeze({
  kind: "kebab-case",
  mapKey(key: string): string {
    return splitIdentifierWords(key, "-");
  },
});

/** 创建自定义字段外部键名映射策略（显式 .from() 声明始终优先于模型级命名策略） */
export function defineNaming(mapKey: (key: string) => string): NamingStrategy<"custom"> {
  if (typeof mapKey !== "function") {
    throw new TypeError("defineNaming requires a key mapping function");
  }
  return Object.freeze({
    kind: "custom",
    mapKey(key: string): string {
      const mapped = mapKey(key);
      if (typeof mapped !== "string") {
        throw new TypeError("NamingStrategy.mapKey must return a string");
      }
      return mapped;
    },
  });
}

function splitIdentifierWords(input: string, delimiter: string): string {
  return input
    .replace(/([A-Z]+)([A-Z][a-z])/g, `$1${delimiter}$2`)
    .replace(/([a-z0-9])([A-Z])/g, `$1${delimiter}$2`)
    .toLowerCase();
}
