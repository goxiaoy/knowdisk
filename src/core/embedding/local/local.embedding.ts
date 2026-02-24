import type { LocalEmbeddingExtractor } from "../../model/model-download.service.types";

export type LocalExtractor = LocalEmbeddingExtractor;

export async function embedWithLocalProvider(
  text: string,
  extractor: LocalExtractor,
): Promise<number[]> {
  const output = (await extractor(text, {
    pooling: "mean",
    normalize: true,
  })) as { data?: ArrayLike<number> };
  if (!output?.data) {
    throw new Error("local embedding output missing data");
  }
  return Array.from(output.data);
}
