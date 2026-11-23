export type PathSegment = string | number;

export interface ValidationIssue {
  readonly path: readonly PathSegment[];
  readonly code: string;
  readonly message: string;
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
  readonly code: string;
  readonly message: string;
  readonly path?: readonly PathSegment[];
}

export interface CodecContext {
  /** 立即中断当前规则并记录一条校验问题 */
  fail(this: void, code: string, message: string): never;
  /** 记录一条校验问题但不中断后续检查（支持指定相对子路径） */
  issue(this: void, detail: CodecIssueInput): void;
}

/** 携带当前实例只读冻结状态的状态化编解码上下文 */
export interface StatefulCodecContext<S extends object> extends CodecContext {
  /** 当前编解码器实例的只读冻结状态 */
  readonly state: Readonly<S>;
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

/** 标准双向值编解码器，提供强类型契约编解码、未知边界解析/倾倒与向对象字段跃迁 */
export interface Codec<T, Encoded = T> extends CodecLike<T, Encoded>, StandardSchemaV1<Encoded, T> {
  readonly [Symbol.toStringTag]: "modvia.Codec";
  /** 按已知外部契约类型校验并解码为业务值 */
  decode(this: void, input: Encoded): T;
  /** 按已知业务类型校验并编码为外部表示 */
  encode(this: void, value: T): Encoded;
  /** 按已知外部契约类型校验解码并返回判别结果，不抛出校验异常 */
  safeDecode(this: void, input: Encoded): SafeResult<T>;
  /** 按已知业务类型校验编码并返回判别结果，不抛出校验异常 */
  safeEncode(this: void, value: T): SafeResult<Encoded>;
  /** 面向未知外部输入校验并解析为业务值 */
  parse(this: void, input: unknown): T;
  /** 面向未知外部输入安全解析并返回判别结果，不抛出校验异常 */
  safeParse(this: void, input: unknown): SafeResult<T>;
  /** 面向未知候选输入校验并输出为外部表示 */
  dump(this: void, input: unknown): Encoded;
  /** 面向未知候选输入安全输出为外部表示，不抛出校验异常 */
  safeDump(this: void, input: unknown): SafeResult<Encoded>;
  /**
   * 对业务值附加过程式对称检查，支持通过 context.issue 收集多条错误与子路径
   *
   * @description 基础 Codec 通过后才调用回调；对模型调用时，解码阶段自动将声明字段名路径映射为外部键名
   */
  check(this: void, rule: (value: T, context: CodecContext) => void): Codec<T, Encoded>;
  /** 用类型守卫谓词在两端对称校验业务值，并将解码侧静态类型收窄为子类型 Narrowed */
  refine<Narrowed extends T>(
    this: void,
    predicate: (value: T) => value is Narrowed,
    code: string,
    message: string,
  ): Codec<Narrowed, Encoded>;
  /** 用布尔谓词在解码与编码两端对称校验业务值，强制指定稳定错误码 */
  refine(
    this: void,
    predicate: (value: T) => boolean,
    code: string,
    message: string,
  ): Codec<T, Encoded>;
  /**
   * 对业务值执行同类型幂等规范化清洗，解码与编码两端共同维持规范形态
   *
   * @description 基础 Codec 校验通过后执行；确保任意合法值往返满足收敛律
   */
  normalize(this: void, fn: (value: T) => T): Codec<T, Encoded>;
  /** 为解码出的业务值附加编译期名义品牌标签，编码端保持原外部类型且运行时零额外包装 */
  brand<const Name extends string | symbol>(this: void): Codec<Branded<T, Name>, Encoded>;
  /** 为当前 Codec 附加静态文档说明文本（供结构反射与 JSON Schema 导出读取，零运行时开销） */
  describe(this: void, description: string): Codec<T, Encoded>;
  /**
   * 将当前 Codec 与下游状态化 Codec 串联为双向管道，保留下游自有链式方法
   *
   * @description 解码按「当前 → next」顺序执行，编码按「next → 当前」逆序执行
   */
  pipe<Next, NextEncoded extends T, Trait extends CodecTrait>(
    this: void,
    next: WithCodecTrait<Next, NextEncoded, Trait>,
  ): WithCodecTrait<Next, Encoded, Trait>;
  /**
   * 将当前 Codec 与下游 Codec 串联为双向管道
   *
   * @description 解码按「当前 → next」顺序执行，编码按「next → 当前」逆序执行
   */
  pipe<Next>(this: void, next: ValueCodecInput<Next, T>): Codec<Next, Encoded>;
  /**
   * 将一个或多个显式字面量作为哨兵值加入双向取值范围
   *
   * @description 编解码均先按 Object.is 优先匹配字面量，命中时原样返回
   */
  or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(
    this: void,
    ...values: Literals
  ): Codec<T | Literals[number], Encoded | Literals[number]>;
  /** 允许值为 null，等价于 .or(null) */
  nullable(this: void): Codec<T | null, Encoded | null>;
  /** 指定作为对象字段时的外部键别名，跃迁为必填字段描述符 */
  alias<NextSource extends string>(
    this: void,
    source: NextSource,
  ): Field<T, Encoded, NextSource, "required">;
  /** 允许父对象省略此键，跃迁为可选字段描述符 */
  optional(this: void): Field<T, Encoded, undefined, "optional">;
  /** 指定父对象解码缺键时的业务默认值，跃迁为带默认值的字段描述符（DTO 可选，模型必填） */
  default(this: void, provider: DefaultProvider<T>): Field<T, Encoded, undefined, "defaulted">;
}

/** 绑定了外部键别名与键缺省规则的对象字段描述符 */
export interface Field<
  T,
  Encoded = T,
  Source extends string | undefined = undefined,
  Presence extends FieldPresence = "required",
>
  extends CodecLike<T, Encoded>, StandardSchemaV1<Encoded, T> {
  readonly [Symbol.toStringTag]: "modvia.Field";
  /** 剥离外部键别名与缺省性后的纯值级 Codec */
  readonly codec: Codec<T, Encoded>;
  /** 外部字段别名，未指定时沿用模型属性名 */
  readonly source: Source;
  /** 父对象在编解码时是否允许省略此键 */
  readonly presence: Presence;
  /** 按已知外部契约类型校验单个值并解码 */
  decode(this: void, input: Encoded): T;
  /** 按已知业务类型校验单个值并编码 */
  encode(this: void, value: T): Encoded;
  /** 按已知外部契约类型安全解码单个值并返回判别结果 */
  safeDecode(this: void, input: Encoded): SafeResult<T>;
  /** 按已知业务类型安全编码单个值并返回判别结果 */
  safeEncode(this: void, value: T): SafeResult<Encoded>;
  /** 面向未知外部输入校验并解析单个值 */
  parse(this: void, input: unknown): T;
  /** 面向未知外部输入安全解析单个值并返回判别结果 */
  safeParse(this: void, input: unknown): SafeResult<T>;
  /** 面向未知候选输入校验并输出单个外部值 */
  dump(this: void, input: unknown): Encoded;
  /** 面向未知候选输入安全输出单个外部值并返回判别结果 */
  safeDump(this: void, input: unknown): SafeResult<Encoded>;
  /** 改绑父对象读写此字段时使用的外部键别名 */
  alias<NextSource extends string>(
    this: void,
    source: NextSource,
  ): Field<T, Encoded, NextSource, Presence>;
  /** 允许父对象省略此键，键存在时仍执行值规则 */
  optional(this: void): Field<T, Encoded, Source, "optional">;
  /** 将字段恢复为父对象必填键 */
  required(this: void): Field<T, Encoded, Source, "required">;
  /** 指定父对象解码缺键时的业务默认值（DTO 可选，模型必填） */
  default(this: void, provider: DefaultProvider<T>): Field<T, Encoded, Source, "defaulted">;
  /** 在保留字段外部名与缺省性的前提下，向值规则追加哨兵字面量 */
  or<const Literals extends readonly [FieldLiteral, ...FieldLiteral[]]>(
    this: void,
    ...values: Literals
  ): Field<T | Literals[number], Encoded | Literals[number], Source, Presence>;
  /** 允许字段值为 null，同时保留外部名与缺省性 */
  nullable(this: void): Field<T | null, Encoded | null, Source, Presence>;
  /** 为字段底层规则附加静态文档说明文本，同时保留外部键别名与缺省性 */
  describe(this: void, description: string): Field<T, Encoded, Source, Presence>;
}

export type InferValue<C> = C extends CodecLike<infer Value, infer _Encoded> ? Value : never;

export type InferEncoded<C> = C extends CodecLike<infer _Value, infer Encoded> ? Encoded : never;

/** 自定义 Codec 可选附带的外部/内部静态结构元数据，供独立 Schema 导出工具读取 */
export interface CustomCodecMeta {
  readonly format?: string;
  readonly description?: string;
  /** 外部编码端（DTO / Encoded）对应的 JSON Schema 描述片段 */
  readonly encodedSchema?: Readonly<Record<string, unknown>>;
  /** 内部业务端（Data / T）对应的 JSON Schema 描述片段；省略时默认沿用 encodedSchema */
  readonly decodedSchema?: Readonly<Record<string, unknown>>;
}

type WithDescription<T> = T & { readonly description?: string };

/** 只读编解码结构描述符，与执行闭包完全解耦，零运行时校验开销 */
export type CodecDescriptor =
  | WithDescription<{
      readonly kind: "string";
      readonly trim: boolean;
      readonly minLength?: number;
      readonly maxLength?: number;
      readonly pattern?: string;
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
  | WithDescription<{ readonly kind: "boolean" }>
  | WithDescription<{ readonly kind: "unknown" }>
  | WithDescription<{ readonly kind: "literal"; readonly values: readonly FieldLiteral[] }>
  | WithDescription<{ readonly kind: "enum"; readonly values: readonly string[] }>
  | WithDescription<{ readonly kind: "datetime" }>
  | WithDescription<{
      readonly kind: "array";
      readonly item: Codec<unknown, unknown>;
      readonly minLength?: number;
      readonly maxLength?: number;
    }>
  | WithDescription<{
      readonly kind: "tuple";
      readonly items: readonly Codec<unknown, unknown>[];
    }>
  | WithDescription<{
      readonly kind: "record";
      readonly key?: Codec<string, string>;
      readonly value: Codec<unknown, unknown>;
    }>
  | WithDescription<{
      readonly kind: "or";
      readonly base: Codec<unknown, unknown>;
      readonly literals: readonly FieldLiteral[];
    }>
  | WithDescription<{
      readonly kind: "union";
      readonly branches: readonly Codec<unknown, unknown>[];
    }>
  | WithDescription<{
      readonly kind: "taggedUnion";
      readonly discriminator: string;
      readonly externalKey: string;
      readonly branches: readonly Codec<unknown, unknown>[];
    }>
  | WithDescription<{
      readonly kind: "model";
      readonly fields: Readonly<Record<string, CodecLike<unknown, unknown>>>;
      readonly strict: boolean;
    }>
  | WithDescription<{
      readonly kind: "pipe";
      readonly first: Codec<unknown, unknown>;
      readonly second: Codec<unknown, unknown>;
    }>
  | WithDescription<{
      readonly kind: "invert";
      readonly inner: Codec<unknown, unknown>;
    }>
  | WithDescription<{
      readonly kind: "lazy";
      readonly resolve: () => Codec<unknown, unknown>;
    }>
  | WithDescription<{
      readonly kind: "custom";
      readonly format?: string;
      readonly encodedSchema?: Readonly<Record<string, unknown>>;
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

/** 脱离具体内部状态类型的自有链式方法签名特征表 */
export type CodecTrait = object;

/** 将方法特征表绑定为返回同族 WithCodecTrait 实例的链式方法集合 */
export type BoundCodecTrait<T, Encoded, Trait extends CodecTrait> = {
  readonly [K in keyof Trait]: Trait[K] extends (...args: infer Args) => unknown
    ? (this: void, ...args: Args) => WithCodecTrait<T, Encoded, Trait>
    : never;
};

export declare const codecTraitSymbol: unique symbol;

export interface TraitCodecBase<T, Encoded, Trait extends CodecTrait> extends Codec<T, Encoded> {
  readonly [codecTraitSymbol]?: Trait;
  /** 为当前实例附加静态文档说明文本，同时完整保留全部自有链式方法 */
  describe(this: void, description: string): WithCodecTrait<T, Encoded, Trait>;
}

/** 附着自有链式方法特征的标准双向编解码器（内部状态与管道实现细节完全封装） */
export type WithCodecTrait<T, Encoded, Trait extends CodecTrait> = TraitCodecBase<
  T,
  Encoded,
  Trait
> &
  BoundCodecTrait<T, Encoded, NoInfer<Trait>>;
