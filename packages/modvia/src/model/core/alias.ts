import type { CodecLike, CodecOrField, Field, FieldLike } from "../../codec/core/types.ts";

export type AliasKind = "snake_case" | "kebab-case" | "custom";

export interface Alias<Kind extends AliasKind = "custom"> {
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

export type MapAliasedKey<Key extends string, Kind extends AliasKind> = Kind extends "snake_case"
  ? SnakeCase<Key>
  : Kind extends "kebab-case"
    ? KebabCase<Key>
    : string;

type BindFieldSource<Entry, MappedSource extends string> =
  Entry extends FieldLike<infer T, infer E, infer Source, infer Presence>
    ? Source extends string
      ? Entry
      : Field<T, E, MappedSource, Presence>
    : Entry extends CodecLike<infer T, infer E>
      ? Field<T, E, MappedSource, "required">
      : never;

export type ApplyAlias<
  Fields extends Readonly<Record<string, CodecOrField>>,
  Kind extends AliasKind,
> = {
  readonly [Key in keyof Fields]: Key extends string
    ? BindFieldSource<Fields[Key], MapAliasedKey<Key, Kind>>
    : Fields[Key];
};

const snakeCaseStrategy: Alias<"snake_case"> = Object.freeze({
  kind: "snake_case",
  mapKey(key: string): string {
    return splitIdentifierWords(key, "_");
  },
});

const kebabCaseStrategy: Alias<"kebab-case"> = Object.freeze({
  kind: "kebab-case",
  mapKey(key: string): string {
    return splitIdentifierWords(key, "-");
  },
});

function defineAlias(mapKey: (key: string) => string): Alias<"custom"> {
  if (typeof mapKey !== "function") {
    throw new TypeError("Alias.define requires a key mapping function");
  }
  return Object.freeze({
    kind: "custom",
    mapKey(key: string): string {
      const mapped = mapKey(key);
      if (typeof mapped !== "string") {
        throw new TypeError("Alias.mapKey must return a string");
      }
      return mapped;
    },
  });
}

/** 模型级字段外部键别名策略集合（含内置 snakeCase / kebabCase 与自定义 Alias.define） */
export const Alias = Object.freeze({
  /** 将模型属性名按编译期与运行期同步规则映射为 snake_case 外部键别名 */
  snakeCase: snakeCaseStrategy,
  /** 将模型属性名按编译期与运行期同步规则映射为 kebab-case 外部键别名 */
  kebabCase: kebabCaseStrategy,
  /** 创建自定义模型级外部键别名策略（字段显式 .alias() 声明始终优先于模型级 alias 策略） */
  define: defineAlias,
});

function splitIdentifierWords(input: string, delimiter: string): string {
  return input
    .replace(/([A-Z]+)([A-Z][a-z])/g, `$1${delimiter}$2`)
    .replace(/([a-z0-9])([A-Z])/g, `$1${delimiter}$2`)
    .toLowerCase();
}
