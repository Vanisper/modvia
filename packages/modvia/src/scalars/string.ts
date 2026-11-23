function isRegExpInstance(value: unknown): value is RegExp {
  return value instanceof RegExp || Object.prototype.toString.call(value) === "[object RegExp]";
}

/** 剥离正则表达式中的全局有状态标志（g），拒绝改变锚点语义的粘滞标志（y），确保重复校验幂等 */
export function sanitizeStatelessPattern(pattern: RegExp): RegExp {
  if (!isRegExpInstance(pattern)) {
    throw new TypeError("pattern must be a RegExp instance");
  }
  if (pattern.flags.includes("y")) {
    throw new RangeError(
      'Sticky flag "y" is stateful and not supported in pattern(); use "^" anchor instead',
    );
  }
  return new RegExp(pattern.source, pattern.flags.replace(/g/g, ""));
}
