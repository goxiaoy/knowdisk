import { createHash } from "node:crypto";
import type { ChunkSpan } from "../processor/file-index.processor.types";
import type { ChunkingConfig, ChunkingService } from "./chunker.service.types";

export function createChunkingService(config: ChunkingConfig): ChunkingService {
  return {
    async chunkParsedStream(
      input: AsyncIterable<{ text: string; startOffset: number }>,
    ): Promise<ChunkSpan[]> {
      const spans: ChunkSpan[] = [];
      for await (const part of input) {
        spans.push(...chunkText(part.text, part.startOffset, config));
      }
      return spans;
    },
  };
}

function chunkText(
  text: string,
  baseOffset: number,
  config: ChunkingConfig,
): ChunkSpan[] {
  const spans: ChunkSpan[] = [];
  let cursor = 0;
  while (cursor < text.length) {
    const end = Math.min(text.length, cursor + config.sizeChars);
    const chunk = text.slice(cursor, end);
    if (chunk.trim()) {
      spans.push({
        text: chunk,
        startOffset: baseOffset + cursor,
        endOffset: baseOffset + end,
        tokenCount: estimateTokens(chunk, config.charsPerToken),
        chunkHash: hashText(chunk),
      });
    }
    if (end >= text.length) {
      break;
    }
    cursor = Math.max(0, end - config.overlapChars);
  }
  return spans;
}

function estimateTokens(text: string, charsPerToken: number) {
  return Math.max(1, Math.ceil(text.length / charsPerToken));
}

function hashText(text: string) {
  return createHash("sha256").update(text).digest("hex");
}
