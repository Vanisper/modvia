export function writeOwnField(target: object, key: string, value: unknown): void {
  if (key !== "__proto__" && !(key in target)) {
    (target as Record<string, unknown>)[key] = value;
    return;
  }
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  if (prototype === Object.prototype || prototype === null) {
    return !Array.isArray(value);
  }
  return !Array.isArray(value) && isObjectPrototype(prototype);
}

export function isObjectPrototype(prototype: object): boolean {
  if (prototype === Object.prototype) return true;
  if (Reflect.getPrototypeOf(prototype) !== null) return false;

  // 跨上下文的内建 Object 经 Function.prototype 继承其所属上下文的 Object.prototype
  const constructor: unknown = Object.getOwnPropertyDescriptor(prototype, "constructor")?.value;
  if (typeof constructor !== "function") return false;
  const functionPrototype = Reflect.getPrototypeOf(constructor);
  return functionPrototype !== null && Reflect.getPrototypeOf(functionPrototype) === prototype;
}
