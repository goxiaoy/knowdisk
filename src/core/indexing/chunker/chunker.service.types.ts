import type { ChunkSpan } from "../processor/file-index.processor.types";

export type ChunkingConfig = {
  sizeChars: number;
  overlapChars: number;
  charsPerToken: number;
};

export type ChunkingService = {
  chunkParsedStream: (
    input: AsyncIterable<{ text: string; startOffset: number }>,
  ) => Promise<ChunkSpan[]>;
};
