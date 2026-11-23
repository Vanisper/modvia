/** 剥离正则表达式中的有状态标志（g / y），确保多次重复校验保持无状态幂等 */
export function sanitizeStatelessPattern(pattern: RegExp): RegExp {
  if (!(pattern instanceof RegExp)) {
    throw new TypeError("pattern must be a RegExp instance");
  }
  return new RegExp(pattern.source, pattern.flags.replace(/[gy]/g, ""));
}
