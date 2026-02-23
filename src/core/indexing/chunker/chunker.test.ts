import { expect, test } from "bun:test";
import { createChunkingService } from "./chunker.service";

test("chunker splits with overlap and preserves offsets", async () => {
  async function* input() {
    yield { text: "a".repeat(2500), startOffset: 0 };
  }

  const chunking = createChunkingService({
    sizeChars: 1200,
    overlapChars: 200,
    charsPerToken: 4,
  });
  const chunks = await chunking.chunkParsedStream(input());
  expect(chunks.length).toBe(3);
  expect(chunks[0]?.startOffset).toBe(0);
  expect(chunks[0]?.endOffset).toBe(1200);
  expect(chunks[1]?.startOffset).toBe(1000);
  expect(chunks[1]?.endOffset).toBe(2200);
  expect(chunks[2]?.startOffset).toBe(2000);
  expect(chunks[2]?.endOffset).toBe(2500);
  expect((chunks[0]?.tokenCount ?? 0) > 0).toBe(true);
});
