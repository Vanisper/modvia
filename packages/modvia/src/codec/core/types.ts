import type { BuiltinIssueCode } from "./issues.ts";

export type PathSegment = string | number;

/** 校验错误码：涵盖全部内置稳定错误码，同时允许自定义或生态桥接命名空间（如 `zod.*`） */
export type IssueCode = BuiltinIssueCode | (string & {});

/** 校验问题附带的只读结构化参数（仅含冻结原始值或冻结数组，供上层多语言文案插值） */
export type IssueParams = Readonly<Record<string, unknown>>;

export interface ValidationIssue {
  readonly path: readonly PathSegment[];
  readonly code: IssueCode;
  readonly message: string;
  /** 可选冻结参数表：不含与 code 语义重复的冗余字段，且不暴露可变对象 */
  readonly params?: IssueParams;
}

export type SafeResult<T> =
  | {
      readonly ok: true;
      readonly value: T;
      readonly issues?: undefined;
    }
  | {
      readonly ok: false;
      readonly issues: readonly ValidationIssue[];
      readonly value?: undefined;
    };

export interface CodecIssueInput {
  readonly code: IssueCode;
  readonly message: string;
  readonly path?: readonly PathSegment[];
  readonly params?: IssueParams;
}

export interface CodecContext {
  /** 立即中断当前规则并记录一条校验问题（用于深层辅助函数或 .check 中提前退出） */
  fail(code: IssueCode, message: string, params?: IssueParams): never;
  /** 记录一条校验问题并返回不透明 Failed 标记（零抛错；可作为单步失败返回值，也可连续调用收集多错） */
  issue(detail: CodecIssueInput): Failed;
  /** 判定 context.run 或 context.issue 的返回值是否为失败标记 */
  failed(this: void, value: unknown): value is Failed;
}

declare const failedBrand: unique symbol;

/** context.run 与 context.issue 的不透明失败标记：仅能由内核产生，必须经 context.failed 收窄后才能把结果当作业务值使用 */
export interface Failed {
  readonly [failedBrand]: true;
}

/** 携带当前实例只读冻结状态的编解码上下文 */
export interface StatefulCodecContext<S extends object> extends CodecContext {
  /** 当前编解码器实例的只读冻结状态 */
  readonly state: Readonly<S>;
}

/** 解码侧 handler 上下文：可在同一次运行与路径下解码子 Codec，失败时不中断 */
export interface DecodeContext<
  S extends object = Record<never, never>,
> extends StatefulCodecContext<S> {
  /** 以解码方向运行子 Codec，at 为相对路径段；失败返回 Failed 并已记录问题 */
  run<T>(child: CodecLike<T, unknown>, input: unknown, at?: PathSegment): T | Failed;
}

/** 编码侧 handler 上下文：可在同一次运行与路径下编码子 Codec，失败时不中断 */
export interface EncodeContext<
  S extends object = Record<never, never>,
> extends StatefulCodecContext<S> {
  /** 以编码方向运行子 Codec，at 为相对路径段；失败返回 Failed 并已记录问题 */
  run<E>(child: CodecLike<unknown, E>, input: unknown, at?: PathSegment): E | Failed;
}

export declare const brandSymbol: unique symbol;

export interface Brand<Name extends string | symbol> {
  readonly [brandSymbol]: { readonly [K in Name]: true };
}

/** 附加编译期名义品牌标签的业务类型，支持多层品牌叠加 */
export type Branded<T, Name extends string | symbol> = T & Brand<Name>;

/** Standard Schema v1 互操作接口，零运行时依赖对接表单与全栈框架 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": StandardSchemaV1.Props<Input, Output>;
}

export declare namespace StandardSchemaV1 {
  export interface Props<Input = unknown, Output = Input> {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (this: void, value: unknown) => Result<Output> | Promise<Result<Output>>;
    readonly types?: Types<Input, Output> | undefined;
  }

  export interface Types<Input = unknown, Output = Input> {
    readonly input: Input;
    readonly output: Output;
  }

  export type Result<Output> = SuccessResult<Output> | FailureResult;

  export interface SuccessResult<Output> {
    readonly value: Output;
    readonly issues?: undefined;
  }

  export interface FailureResult {
    readonly issues: ReadonlyArray<Issue>;
    readonly value?: undefined;
  }

  export interface Issue {
    readonly message: string;
    readonly path?: ReadonlyArray<PropertyKey | PathSegmentObject> | undefined;
  }

  export interface PathSegmentObject {
    readonly key: PropertyKey;
  }
}

/** 最小双向转换协议，允许手写对象直接接入容器与模型（正反两端均须对 unknown 输入做运行时防御） */
export interface CodecLike<T, Encoded = T> {
  /** 校验外部输入并返回业务值 */
  decode(this: void, input: unknown): T;
  /** 校验候选业务值并转换为外部表示 */
  encode(this: void, input: unknown): Encoded;
}

/** 值级容器接受任意 Codec 或自定义 CodecLike，编译期拒绝带键绑定元数据的 Field */
export type ValueCodecInput<T, Encoded = T> = CodecLike<T, Encoded> & {
  readonly [Symbol.toStringTag]?: "modvia.Codec";
};

export type FieldPresence = "required" | "optional" | "defaulted";
export type FieldLiteral = string | number | boolean | null | undefined;

/** 原始字面量可直接作为默认值传入，对象/数组等非原始值须通过工厂函数 () => T 提供以防实例间共享引用 */
export type DefaultProvider<T> = (T extends FieldLiteral ? T : never) | (() => T);

/**
 * 协变的标准 Modvia Codec 协议：仅含协变执行与反射成员，可接收任意具体类型的 Codec、WithCodecTrait 或 Model
 *
 * @description 供 CodecDescriptor、Codec.extendStandard 与外部适配包（如 @modvia/json-schema）协变引用任意标准 Codec
 */
export interface StandardCodec<out T = unknown, out Encoded = T>
  extends CodecLike<T, Encoded>, StandardSchemaV1<Encoded, T> {
  readonly [Symbol.toStringTag]: "modvia.Codec";
  /** 面向未知外部输入校验并解析为业务值 */
  parse(this: void, input: unknown): T;
  /** 面向未知外部输入安全解析并返回判别结果，不抛出校验异常 */
  safeParse(this: void, input: unknown): SafeResult<T>;
  /** 面向未知候选输入校验并输出为外部表示 */
  dump(this: void, input: unknown): Encoded;
  /** 面向未知候选输入安全输出为外部表示，不抛出校验异常 */
  safeDump(this: void, input: unknown): SafeResult<Encoded>;
}

/**
 * 标准双向值编解码器，提供强类型契约编解码、未知边界解析/倾倒与向对象字段跃迁
 *
 * @description 执行方法（decode / encode / parse / dump 及其 safe 变体）可解构独立调用；构建方法基于原型并依赖 this
 */
export interface Codec<T, Encoded = T> extends StandardCodec<T, Encoded> {
  /** 按已知外部契约类型校验并解码为业务值 */
  decode(this: void, input: Encoded): T;
  /** 按已知业务类型校验并编码为外部表示 */
  encode(this: void, value: T): Encoded;
  /** 按已知外部契约类型校验解码并返回判别结果，不抛出校验异常 */
  safeDecode(this: void, input: Encoded): SafeResult<T>;
  /** 按已知业务类型校验编码并返回判别结果，不抛出校验异常 */
  safeEncode(this: void, value: T): SafeResult<Encoded>;
  /**
   * 对业务值附加过程式对称检查，支持通过 context.issue 收集多条错误与子路径
   *
   * @description 基础 Codec 通过后才调用回调；对模型调用时，解码阶段自动将声明字段名路径映射为外部键名
   */
  check(rule: (value: T, context: CodecContext) => void): Codec<T, Encoded>;
  /** 用类型守卫谓词在两端对称校验业务值，并将解码侧静态类型收窄为子类型 Narrowed */
  refine<Narrowed extends T>(
    predicate: (value: T) => value is Narrowed,
    code: IssueCode,
    message: string,
    params?: IssueParams,
  ): Codec<Narrowed, Encoded>;
  /** 用布尔谓词在解码与编码两端对称校验业务值，强制指定稳定错误码 */
  refine(
    predicate: (value: T) => boolean,
    code: IssueCode,
    message: string,
    params?: IssueParams,
  ): Codec<T, Encoded>;
  /**
   * 对业务值执行同类型幂等规范化清洗，解码与编码两端共同维持规范形态
   *
   * @description 基础 Codec 校验通过后执行；确保任意合法值往返满足收敛律
   */
  normalize(fn: (value: T) => T): Codec<T, Encoded>;
  /** 为解码出的业务值附加编译期名义品牌标签，编码端保持原外部类型且运行时零额外包装 */
  brand<const Name extends string | symbol>(): Codec<Branded<T, Name>, Encoded>;
  /** 为当前 Codec 附加静态文档说明文本（同阶派生，完整保留当前实例的全部方法） */
  describe(description: string): this;
  /**
   * 将当前 Codec 接入下游带自有方法的 Codec 上游，保留下游全部值域方法并重绑外部类型
   *
   * @description 解码按「当前 → next」顺序执行，编码按「next → 当前」逆序执行
   */
  pipe<Next, NextEncoded extends T, Trait extends CodecTrait>(
    next: WithCodecTrait<Next, NextEncoded, Trait, object>,
  ): WithCodecTrait<Next, Encoded, Trait>;
  /**
   * 将当前 Codec 与下游 Codec 串联为双向管道
   *
   * @description 解码按「当前 → next」顺序执行，编码按「next → 当前」逆序执行
   */
  pipe<Next>(next: ValueCodecInput<Next, T>): Codec<Next, Encoded>;
  /**
   * 将一个或多个显式字面量作为哨兵值加入双向取值范围
   *
   * @description 编解码均先按 Object.is 优先匹配字面量，命中时原样返回
   */
  or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(
    ...values: Literals
  ): Codec<T | Literals[number], Encoded | Literals[number]>;
  /** 允许值为 null，等价于 .or(null) */
  nullable(): Codec<T | null, Encoded | null>;
  /** 指定作为对象字段时的外部键别名，跃迁为必填字段描述符 */
  alias<NextSource extends string>(source: NextSource): Field<T, Encoded, NextSource, "required">;
  /** 允许父对象省略此键，跃迁为可选字段描述符 */
  optional(): Field<T, Encoded, undefined, "optional">;
  /** 指定父对象解码缺键时的业务默认值，跃迁为带默认值的字段描述符（DTO 可选，模型必填） */
  default(provider: DefaultProvider<T>): Field<T, Encoded, undefined, "defaulted">;
}

/** 对象属性槽位的纯数据协议（跨副本互操作只依赖这些自有数据成员），供模型字段表协变接收任意具体 Field */
export interface FieldLike<
  out T = unknown,
  out Encoded = T,
  out Source extends string | undefined = string | undefined,
  out Presence extends FieldPresence = FieldPresence,
> {
  readonly [Symbol.toStringTag]: "modvia.Field";
  /** 剥离对象槽位元数据后的底层值级规则 */
  readonly codec: CodecLike<T, Encoded>;
  /** 外部字段别名，未指定时沿用模型属性名 */
  readonly source: Source;
  /** 父对象在编解码时是否允许省略此键 */
  readonly presence: Presence;
  /** 当前对象属性槽位专属的静态文档说明文本 */
  readonly description?: string | undefined;
  /** presence 为 "defaulted" 时，父对象解码缺键所用的业务默认值提供器 */
  readonly fallback?: (() => T) | undefined;
}

/** 绑定了外部键别名、缺省规则与属性说明的对象槽位描述符（非独立值级 Codec，底层值规则通过 .codec 读取） */
export interface Field<
  T,
  Encoded = T,
  Source extends string | undefined = undefined,
  Presence extends FieldPresence = "required",
> extends FieldLike<T, Encoded, Source, Presence> {
  readonly [Symbol.toStringTag]: "modvia.Field";
  /** 剥离对象槽位元数据后的纯值级 Codec */
  readonly codec: Codec<T, Encoded>;
  /** 外部字段别名，未指定时沿用模型属性名 */
  readonly source: Source;
  /** 父对象在编解码时是否允许省略此键 */
  readonly presence: Presence;
  /** 当前对象属性槽位专属的静态文档说明文本（未声明时为 undefined） */
  readonly description: string | undefined;
  /** 父对象解码缺键时的业务默认值提供器（仅 presence 为 "defaulted" 时存在） */
  readonly fallback: (() => T) | undefined;
  /** 改绑父对象读写此字段时使用的外部键别名 */
  alias<NextSource extends string>(source: NextSource): Field<T, Encoded, NextSource, Presence>;
  /** 允许父对象省略此键，键存在时仍执行值规则 */
  optional(): Field<T, Encoded, Source, "optional">;
  /** 将字段恢复为父对象必填键 */
  required(): Field<T, Encoded, Source, "required">;
  /** 指定父对象解码缺键时的业务默认值（DTO 可选，模型必填） */
  default(provider: DefaultProvider<T>): Field<T, Encoded, Source, "defaulted">;
  /** 在保留字段外部名、缺省性与属性说明的前提下，向值规则追加哨兵字面量 */
  or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(
    ...values: Literals
  ): Field<T | Literals[number], Encoded | Literals[number], Source, Presence>;
  /** 允许字段值为 null，同时保留外部名、缺省性与属性说明 */
  nullable(): Field<T | null, Encoded | null, Source, Presence>;
  /** 为当前对象属性槽位设置静态文档说明文本（与 alias / optional / default / or 顺序无关，不克隆底层 codec） */
  describe(description: string): Field<T, Encoded, Source, Presence>;
}

/** 可作为对象模型字段或供反射/Schema 导出读取的统一协变联合输入（值级 CodecLike 或槽位级 FieldLike） */
export type CodecOrField<T = unknown, Encoded = unknown> =
  | CodecLike<T, Encoded>
  | FieldLike<T, Encoded>;

export type InferValue<C> =
  C extends CodecLike<infer Value, infer _Encoded>
    ? Value
    : C extends FieldLike<infer Value, infer _Encoded>
      ? Value
      : never;

export type InferEncoded<C> =
  C extends CodecLike<infer _Value, infer Encoded>
    ? Encoded
    : C extends FieldLike<infer _Value, infer Encoded>
      ? Encoded
      : never;

type WithDescription<T> = T & { readonly description?: string };

/** 精化步骤：refine 携带稳定错误码，check 与 normalize 为不透明回调 */
export type CodecRefinement =
  | { readonly kind: "refine"; readonly code: IssueCode }
  | { readonly kind: "check" }
  | { readonly kind: "normalize" };

/** 内置字符串语义格式标识（不耦合特定 Schema 方言，由独立导出包映射到目标规范） */
export type StringFormat = "uuid" | "email" | "uri" | "ipv4" | "ipv6" | "date" | "time";

/** 只读编解码结构描述符，与执行内核完全解耦，零运行时校验开销 */
export type CodecDescriptor =
  | WithDescription<{
      readonly kind: "string";
      readonly trim?: boolean;
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly pattern?: string;
      readonly format?: StringFormat;
      readonly protocols?: readonly string[];
    }>
  | WithDescription<{
      readonly kind: "number" | "integer";
      readonly min?: number;
      readonly max?: number;
      readonly exclusiveMin?: number;
      readonly exclusiveMax?: number;
    }>
  | WithDescription<{
      readonly kind: "bigint";
      readonly min?: bigint;
      readonly max?: bigint;
      readonly exclusiveMin?: bigint;
      readonly exclusiveMax?: bigint;
    }>
  | WithDescription<{
      readonly kind: "numericString";
      readonly numericKind: "integer" | "number" | "bigint";
    }>
  | WithDescription<{ readonly kind: "boolean" }>
  | WithDescription<{
      readonly kind: "booleanString";
      readonly truthy: readonly string[];
      readonly falsy: readonly string[];
      readonly caseSensitive: boolean;
    }>
  | WithDescription<{ readonly kind: "unknown" }>
  | WithDescription<{ readonly kind: "literal"; readonly values: readonly FieldLiteral[] }>
  | WithDescription<{ readonly kind: "datetime" }>
  | WithDescription<{ readonly kind: "json" }>
  | WithDescription<{
      readonly kind: "array";
      readonly item: StandardCodec;
      readonly minLength?: number;
      readonly maxLength?: number;
    }>
  | WithDescription<{
      readonly kind: "tuple";
      readonly items: readonly StandardCodec[];
    }>
  | WithDescription<{
      readonly kind: "record";
      readonly key?: StandardCodec<string, string>;
      readonly value: StandardCodec;
    }>
  | WithDescription<{
      readonly kind: "or";
      readonly base: StandardCodec;
      readonly literals: readonly FieldLiteral[];
    }>
  | WithDescription<{
      readonly kind: "union";
      readonly branches: readonly StandardCodec[];
    }>
  | WithDescription<{
      readonly kind: "taggedUnion";
      readonly discriminator: string;
      readonly externalKey: string;
      readonly branches: readonly StandardCodec[];
    }>
  | WithDescription<{
      readonly kind: "model";
      readonly fields: Readonly<Record<string, CodecOrField>>;
      readonly strict: boolean;
    }>
  | WithDescription<{
      readonly kind: "refined";
      /** 被精化的内层 Codec（相邻精化层自动扁平合并，inner 恒为非精化节点） */
      readonly inner: StandardCodec;
      /** 由内向外依次叠加的精化步骤，供结构反射得知运行时约束比内层结构更严格 */
      readonly refinements: readonly CodecRefinement[];
    }>
  | WithDescription<{
      readonly kind: "pipe";
      readonly first: StandardCodec;
      readonly second: StandardCodec;
    }>
  | WithDescription<{
      readonly kind: "invert";
      readonly inner: StandardCodec;
    }>
  | WithDescription<{
      readonly kind: "lazy";
      readonly resolve: () => StandardCodec;
    }>
  | WithDescription<{
      readonly kind: "custom";
      readonly format?: string;
      /** 外部编码端（DTO / Encoded）对应的 JSON Schema 描述片段 */
      readonly encodedSchema?: Readonly<Record<string, unknown>>;
      /** 内部业务端（Data / T）对应的 JSON Schema 描述片段 */
      readonly decodedSchema?: Readonly<Record<string, unknown>>;
    }>;

/** Codec 核心保留成员键集合，自定义链式方法禁止覆盖 */
export type ReservedCodecKey = keyof Codec<unknown, unknown> | "__proto__" | "constructor";

/** 状态增量更新表达：可直接返回局部属性补丁，或返回基于冻结旧状态计算局部补丁的函数 */
export type StatePatch<S extends object> =
  | Partial<Readonly<S>>
  | ((this: void, prev: Readonly<S>) => Partial<Readonly<S>>);

/** 自定义链式方法定义表：参数直接对应公开方法签名，返回局部状态补丁或状态演进函数 */
export type CodecMethodBuilders<S extends object> = Readonly<
  Record<string, (this: void, ...args: never[]) => StatePatch<S>>
>;

/** 编译期拦截与 Codec 核心协议同名的自定义方法键 */
export type DisallowReservedCodecKeys<M> = {
  readonly [K in keyof M]: K extends ReservedCodecKey ? never : unknown;
};

/** 脱离具体内部状态类型的自有链式方法签名特征表（只含保持 T 与 Encoded 不变的值域方法） */
export type CodecTrait = object;

/** 将方法特征表绑定为返回同族同类型实例的链式方法集合；Root 为仅根实例（无上游）才携带的派生方法 */
export type BoundCodecTrait<T, Encoded, Trait extends CodecTrait, Root extends object> = {
  readonly [K in keyof Trait]: Trait[K] extends (...args: infer Args) => unknown
    ? (this: StandardCodec, ...args: Args) => WithCodecTrait<T, Encoded, Trait, Root>
    : never;
};

export declare const codecTraitSymbol: unique symbol;

export interface TraitCodecBase<T, Encoded, Trait extends CodecTrait> extends Codec<T, Encoded> {
  readonly [codecTraitSymbol]?: Trait;
}

/**
 * 附着自有链式方法特征的标准双向编解码器
 *
 * @description Trait 方法只约束值域、保持 T 与 Encoded 不变，因此经 .pipe() 接入上游后仍完整保留；
 * Root 为根实例专属的派生方法（如 .fromString()），接入上游后不再提供
 */
export type WithCodecTrait<
  T,
  Encoded,
  Trait extends CodecTrait,
  Root extends object = Record<never, never>,
> = TraitCodecBase<T, Encoded, Trait> & BoundCodecTrait<T, Encoded, NoInfer<Trait>, Root> & Root;
