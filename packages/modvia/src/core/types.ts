export type PathSegment = string | number;

export interface ModelIssue {
  readonly path: readonly PathSegment[];
  readonly code: string;
  readonly message: string;
}

export interface CodecContext {
  fail(code: string, message: string): never;
}

export interface Codec<T, Encoded> {
  decode(input: unknown): T;
  encode(value: T): Encoded;
}

export interface Field<T, Encoded, Source extends string | undefined = undefined> extends Codec<
  T,
  Encoded
> {
  readonly source: Source;
  from<NextSource extends string>(source: NextSource): Field<T, Encoded, NextSource>;
}

export interface Model<Data, DTO, Out extends Data = Data> extends Codec<Out, DTO> {
  withFactory<Next extends Data>(factory: (data: Data) => Next): Model<Data, DTO, Next>;
}

export type InferData<M> = M extends Model<infer Data, infer _DTO, infer _Out> ? Data : never;

export type InferDTO<M> = M extends Model<infer _Data, infer DTO, infer _Out> ? DTO : never;

export type InferModel<M> = M extends Model<infer _Data, infer _DTO, infer Out> ? Out : never;
