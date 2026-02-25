import type { Parser } from "../../parser/parser.types";
import type { EmbeddingProvider } from "../../embedding/embedding.types";
import type { IndexMetadataRepository } from "../metadata/index-metadata.repository.types";
import type { VectorRepository, VectorRow } from "../../vector/vector.repository.types";
import type { ChunkingService } from "../chunker/chunker.service.types";

export type FileIndexVectorStore = Pick<VectorRepository, "upsert" | "deleteBySourcePath">;

export type FileIndexProcessor = {
  indexFile: (path: string, parser: Parser) => Promise<{ skipped: boolean; indexedChunks: number }>;
  deleteFile: (path: string) => Promise<void>;
};

export type FileIndexProcessorDeps = {
  embedding: EmbeddingProvider;
  chunking: ChunkingService;
  vector: FileIndexVectorStore;
  metadata: IndexMetadataRepository;
  getCurrentIndexModel?: () => string;
  nowMs?: () => number;
  makeChunkId?: (input: { fileId: string; startOffset: number | null; endOffset: number | null; chunkHash: string }) => string;
  makeFileId?: (path: string) => string;
};

export type ChunkSpan = {
  text: string;
  startOffset: number | null;
  endOffset: number | null;
  tokenCount: number | null;
  chunkHash: string;
};

export type ChunkDiff = {
  all: ChunkSpan[];
  changedOrNew: ChunkSpan[];
  removedChunkIds: string[];
  hasStructuralChange: boolean;
};

export type VectorUpsertRow = VectorRow;
