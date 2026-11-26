import { formatLiteral } from "../../shared/value.ts";
import type { Invalid, IssueCollector } from "./collector.ts";
import type { CodecContext, Failed, FieldLiteral, IssueParams, PathSegment } from "./types.ts";

/** 内置问题构造结果：携带稳定错误码、默认英文消息与可选结构化参数，可直接传入 context.issue */
export interface BuiltinIssue<Code extends string = string> {
  readonly code: Code;
  readonly message: string;
  readonly params?: IssueParams;
}

function makeIssue<const Code extends string>(
  code: Code,
  message: string,
  params?: IssueParams,
): BuiltinIssue<Code> {
  return params === undefined ? { code, message } : { code, message, params };
}

function constantIssue<const Code extends string>(code: Code, message: string): BuiltinIssue<Code> {
  return Object.freeze({ code, message });
}

// 无参数高频问题预分配冻结常量，消除校验失败时的重复对象分配
const TYPE_STRING = constantIssue("type.string", "Expected a string");
const TYPE_NUMBER = constantIssue("type.number", "Expected a finite number");
const TYPE_INTEGER = constantIssue("type.integer", "Expected a safe integer");
const TYPE_BIGINT = constantIssue("type.bigint", "Expected a bigint");
const TYPE_BOOLEAN = constantIssue("type.boolean", "Expected a boolean");
const TYPE_DATE = constantIssue("type.date", "Expected a valid Date");
const TYPE_ARRAY = constantIssue("type.array", "Expected an array");
const TYPE_PLAIN_OBJECT = constantIssue("type.object", "Expected a plain object");
const TYPE_MODEL_OBJECT = constantIssue("type.object", "Expected a model object");
const FORMAT_INTEGER_STRING = constantIssue(
  "format.integer_string",
  "Expected a base-10 integer string",
);
const FORMAT_NUMBER_STRING = constantIssue(
  "format.number_string",
  "Expected a finite numeric string",
);
const FORMAT_BIGINT_STRING = constantIssue(
  "format.bigint_string",
  "Expected a base-10 bigint string",
);
const FORMAT_ISO_DATETIME = constantIssue("format.iso_datetime", "Invalid ISO date-time");
const FORMAT_ISO_DATE_SYNTAX = constantIssue(
  "format.iso_date",
  "Expected an ISO date string (YYYY-MM-DD)",
);
const FORMAT_ISO_DATE_CALENDAR = constantIssue("format.iso_date", "Invalid calendar date");
const FORMAT_ISO_TIME_SYNTAX = constantIssue(
  "format.iso_time",
  "Expected an ISO time string (HH:mm:ss)",
);
const FORMAT_ISO_TIME_CLOCK = constantIssue("format.iso_time", "Invalid clock time");
const FORMAT_UUID = constantIssue("format.uuid", "Expected a valid UUID");
const FORMAT_EMAIL = constantIssue("format.email", "Expected a valid email address");
const FORMAT_URL = constantIssue("format.url", "Expected a valid URL");
const FORMAT_IPV4 = constantIssue("format.ipv4", "Expected a valid IPv4 address");
const FORMAT_IPV6 = constantIssue("format.ipv6", "Expected a valid IPv6 address");
const FORMAT_JSON = constantIssue("format.json", "Invalid JSON text");
const DATE_OUT_OF_RANGE = constantIssue(
  "date.out_of_range",
  "Date-time exceeds the native Date range",
);
const UNION_NO_MATCH = constantIssue("union.no_match", "Input did not match any union branch");
const JSON_UNSERIALIZABLE = constantIssue(
  "json.unserializable",
  "Value cannot be serialized to JSON",
);

/**
 * 全库内置错误码与默认消息的唯一信源
 *
 * 命名规则（<domain>.<reason>，两段均为 snake_case，三层互斥）：
 * - 类型层 `type.<kind>`：当前方向输入侧的 JS 种类不符
 * - 文本格式层 `format.<wire_format>`：外部文本语法或语义不合法
 * - 值约束层 `<kind>.<rule>`：确定种类的值不满足业务或结构约束
 */
export const builtinIssues = {
  // ── 类型层（type.<kind>）───────────────────────────────────────────────
  typeString: () => TYPE_STRING,
  typeNumber: () => TYPE_NUMBER,
  typeInteger: () => TYPE_INTEGER,
  typeBigint: () => TYPE_BIGINT,
  typeBoolean: () => TYPE_BOOLEAN,
  typeDate: () => TYPE_DATE,
  typeArray: () => TYPE_ARRAY,
  typeObject: (kind: "plain" | "model" = "plain") =>
    kind === "model" ? TYPE_MODEL_OBJECT : TYPE_PLAIN_OBJECT,

  // ── 文本格式层（format.<wire_format>）──────────────────────────────────
  formatIntegerString: () => FORMAT_INTEGER_STRING,
  formatNumberString: () => FORMAT_NUMBER_STRING,
  formatBigintString: () => FORMAT_BIGINT_STRING,
  formatBooleanString: (truthy: readonly string[], falsy: readonly string[]) =>
    makeIssue("format.boolean_string", "Expected a valid boolean string", { truthy, falsy }),
  formatIsoDatetime: () => FORMAT_ISO_DATETIME,
  formatIsoDate: (reason: "syntax" | "calendar" = "syntax") =>
    reason === "calendar" ? FORMAT_ISO_DATE_CALENDAR : FORMAT_ISO_DATE_SYNTAX,
  formatIsoTime: (reason: "syntax" | "clock" = "syntax") =>
    reason === "clock" ? FORMAT_ISO_TIME_CLOCK : FORMAT_ISO_TIME_SYNTAX,
  formatUuid: () => FORMAT_UUID,
  formatEmail: () => FORMAT_EMAIL,
  formatUrl: () => FORMAT_URL,
  formatIpv4: () => FORMAT_IPV4,
  formatIpv6: () => FORMAT_IPV6,
  formatJson: () => FORMAT_JSON,

  // ── 值约束层（<kind>.<rule>）───────────────────────────────────────────
  stringMinLength: (minLength: number) =>
    makeIssue("string.min_length", `Expected at least ${minLength} characters`, { minLength }),
  stringMaxLength: (maxLength: number) =>
    makeIssue("string.max_length", `Expected at most ${maxLength} characters`, { maxLength }),
  stringPattern: (pattern: string) =>
    makeIssue("string.pattern", `String does not match pattern /${pattern}/`, { pattern }),

  numberMin: (min: number) => makeIssue("number.min", `Expected a number >= ${min}`, { min }),
  numberMax: (max: number) => makeIssue("number.max", `Expected a number <= ${max}`, { max }),
  numberGt: (gt: number) => makeIssue("number.gt", `Expected a number > ${gt}`, { gt }),
  numberLt: (lt: number) => makeIssue("number.lt", `Expected a number < ${lt}`, { lt }),

  integerMin: (min: number) => makeIssue("integer.min", `Expected an integer >= ${min}`, { min }),
  integerMax: (max: number) => makeIssue("integer.max", `Expected an integer <= ${max}`, { max }),
  integerGt: (gt: number) => makeIssue("integer.gt", `Expected an integer > ${gt}`, { gt }),
  integerLt: (lt: number) => makeIssue("integer.lt", `Expected an integer < ${lt}`, { lt }),

  bigintMin: (min: bigint) => makeIssue("bigint.min", `Expected a bigint >= ${min}`, { min }),
  bigintMax: (max: bigint) => makeIssue("bigint.max", `Expected a bigint <= ${max}`, { max }),
  bigintGt: (gt: bigint) => makeIssue("bigint.gt", `Expected a bigint > ${gt}`, { gt }),
  bigintLt: (lt: bigint) => makeIssue("bigint.lt", `Expected a bigint < ${lt}`, { lt }),

  dateOutOfRange: () => DATE_OUT_OF_RANGE,

  arrayMinLength: (minLength: number) =>
    makeIssue("array.min_length", `Expected at least ${minLength} items`, { minLength }),
  arrayMaxLength: (maxLength: number) =>
    makeIssue("array.max_length", `Expected at most ${maxLength} items`, { maxLength }),
  tupleLength: (expected: number, actual: number) =>
    makeIssue("tuple.length", `Expected tuple of length ${expected}, got ${actual}`, {
      expected,
      actual,
    }),
  recordDuplicateKey: (key: string) =>
    makeIssue("record.duplicate_key", `Duplicate record key after conversion: ${key}`, { key }),

  objectMissingKey: (key: string, side: "decode" | "encode" = "decode") =>
    makeIssue(
      "object.missing_key",
      side === "decode" ? `Missing required field: ${key}` : `Missing model field: ${key}`,
      { key },
    ),
  objectUnknownKey: (key: string) =>
    makeIssue("object.unknown_key", `Unknown field: ${key}`, { key }),

  literalNoMatch: (expected: readonly FieldLiteral[]) =>
    makeIssue("literal.no_match", `Expected literal: ${expected.map(formatLiteral).join(", ")}`, {
      expected,
    }),

  unionNoMatch: () => UNION_NO_MATCH,
  unionUnknownTag: (discriminator: string, expected: readonly FieldLiteral[]) =>
    makeIssue(
      "union.unknown_tag",
      `Expected discriminator "${discriminator}" to be one of: ${expected.map(formatLiteral).join(", ")}`,
      { discriminator, expected },
    ),

  urlProtocol: (protocol: string, allowed: readonly string[]) =>
    makeIssue("url.protocol", `URL protocol "${protocol}" is not allowed`, { protocol, allowed }),
  jsonUnserializable: () => JSON_UNSERIALIZABLE,
} as const;

type Catalog = typeof builtinIssues;

/** Modvia 内置校验错误码联合类型 */
export type BuiltinIssueCode = ReturnType<Catalog[keyof Catalog]>["code"];

const builtinIssueCodeMap: Record<BuiltinIssueCode, true> = {
  "type.string": true,
  "type.number": true,
  "type.integer": true,
  "type.bigint": true,
  "type.boolean": true,
  "type.date": true,
  "type.array": true,
  "type.object": true,
  "format.integer_string": true,
  "format.number_string": true,
  "format.bigint_string": true,
  "format.boolean_string": true,
  "format.iso_datetime": true,
  "format.iso_date": true,
  "format.iso_time": true,
  "format.uuid": true,
  "format.email": true,
  "format.url": true,
  "format.ipv4": true,
  "format.ipv6": true,
  "format.json": true,
  "string.min_length": true,
  "string.max_length": true,
  "string.pattern": true,
  "number.min": true,
  "number.max": true,
  "number.gt": true,
  "number.lt": true,
  "integer.min": true,
  "integer.max": true,
  "integer.gt": true,
  "integer.lt": true,
  "bigint.min": true,
  "bigint.max": true,
  "bigint.gt": true,
  "bigint.lt": true,
  "date.out_of_range": true,
  "array.min_length": true,
  "array.max_length": true,
  "tuple.length": true,
  "record.duplicate_key": true,
  "object.missing_key": true,
  "object.unknown_key": true,
  "literal.no_match": true,
  "union.no_match": true,
  "union.unknown_tag": true,
  "url.protocol": true,
  "json.unserializable": true,
};

/** 全量内置错误码清单（编译期穷举锁定，并与包文档错误码速查表保持测试锁定的逐项一致） */
export const BUILTIN_ISSUE_CODES: readonly BuiltinIssueCode[] = Object.freeze(
  Object.keys(builtinIssueCodeMap) as BuiltinIssueCode[],
);

/** 通过 context.issue 无抛错记录一条带相对路径的目录内建问题并返回 Failed */
export function pushIssue(
  context: CodecContext,
  entry: BuiltinIssue,
  path: readonly PathSegment[],
): Failed {
  return context.issue({
    code: entry.code,
    message: entry.message,
    path,
    ...(entry.params !== undefined ? { params: entry.params } : {}),
  });
}

/** 向收集器当前路径记录一条目录内建问题 */
export function reportIssue(collector: IssueCollector, entry: BuiltinIssue): Invalid {
  return collector.add(entry.code, entry.message, entry.params);
}

/** 向收集器当前路径追加单个段后记录一条目录内建问题 */
export function reportIssueAt(
  collector: IssueCollector,
  segment: PathSegment,
  entry: BuiltinIssue,
): Invalid {
  return collector.addAtSegment(segment, entry.code, entry.message, entry.params);
}
