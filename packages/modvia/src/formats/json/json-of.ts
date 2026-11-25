import { assertValueCodec } from "../../codec/core/guards.ts";
import type { Codec, CodecTrait, ValueCodecInput, WithCodecTrait } from "../../codec/core/types.ts";
import { jsonString } from "./json-string.ts";

/** 将带自有链式方法特征的 Codec 包装为「JSON 文本 ↔ 业务值 T」双向 Codec，保留全部自有方法 */
export function jsonOf<T, Encoded, Trait extends CodecTrait>(
  codec: WithCodecTrait<T, Encoded, Trait>,
): WithCodecTrait<T, string, Trait>;
/** 将目标值级 Codec 或领域 Model 包装为「JSON 文本 ↔ 业务值 T」的一体化双向 Codec */
export function jsonOf<T, Encoded>(codec: ValueCodecInput<T, Encoded>): Codec<T, string>;
export function jsonOf<T, Encoded>(codec: ValueCodecInput<T, Encoded>): Codec<T, string> {
  assertValueCodec(codec, "jsonOf");
  return jsonString().pipe(codec);
}
