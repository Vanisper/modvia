import { INVALID } from "./errors.ts";
import { assertValueCodec, createCodec, executeCodec } from "./kernel.ts";
import type { Codec, ValueCodecInput } from "./types.ts";

/**
 * 按元素规则双向编解码数组，元素校验错误保留下标路径
 *
 * @description 仅接受值级 Codec；若数组作为对象字段需设别名或可选，请在 arrayOf 返回值上调用 .from() 或 .optional()
 */
export function arrayOf<T, Encoded>(codec: ValueCodecInput<T, Encoded>): Codec<T[], Encoded[]> {
  assertValueCodec(codec, "arrayOf");

  return createCodec<T[], Encoded[]>((input, direction, collector) => {
    if (!Array.isArray(input)) {
      return collector.add("type.array", "Expected an array");
    }

    const output: (T | Encoded)[] = [];
    let failed = false;

    for (let index = 0; index < input.length; index++) {
      collector.pushSegment(index);
      try {
        const converted = executeCodec(codec, input[index], direction, collector);
        if (converted === INVALID) {
          failed = true;
        } else if (!failed) {
          output.push(converted);
        }
      } finally {
        collector.popSegment();
      }
    }

    return failed ? INVALID : (output as T[] | Encoded[]);
  });
}
