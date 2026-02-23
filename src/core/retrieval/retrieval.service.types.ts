import type { EmbeddingProvider } from "../embedding/embedding.types";
import type { FtsSearchRow } from "../indexing/metadata/index-metadata.repository.types";
import type { LoggerService } from "../logger/logger.service.types";
import type { RerankerService } from "../reranker/reranker.types";
import type { VectorMetadata } from "../vector/vector.repository.types";

export type RetrievalVectorRow = {
  chunkId: string;
  score: number;
  vector?: number[];
  metadata: VectorMetadata;
};

export type RetrievalResult = {
  chunkId: string;
  chunkText: string;
  sourcePath: string;
  score: number;
  updatedAt?: string;
  startOffset?: number;
  endOffset?: number;
  tokenEstimate?: number;
};

export type RetrievalChunkInfo = {
  chunkId: string;
  fileId?: string;
  sourcePath: string;
  startOffset?: number;
  endOffset?: number;
  chunkHash?: string;
  tokenCount?: number;
  updatedAtMs?: number;
};

export type RetrievalDeps = {
  embedding: EmbeddingProvider;
  vector: {
    search: (query: number[], opts: { topK: number }) => Promise<RetrievalVectorRow[]>;
  };
  sourceReader?: {
    readRange: (
      path: string,
      startOffset: number,
      endOffset: number,
    ) => Promise<string>;
  };
  metadata: {
    listChunksBySourcePath: (sourcePath: string) => Array<{
      chunkId: string;
      fileId: string;
      sourcePath: string;
      startOffset: number | null;
      endOffset: number | null;
      chunkHash: string;
      tokenCount: number | null;
      updatedAtMs: number;
    }>;
  };
  fts?: {
    searchFts: (query: string, limit: number) => FtsSearchRow[];
    searchTitleFts?: (query: string, limit: number) => FtsSearchRow[];
  };
  defaults: {
    topK: number;
    ftsTopN?: number;
  };
  reranker?: RerankerService;
  logger?: LoggerService;
};

export type RetrievalService = {
  search: (query: string, opts: { topK?: number; titleOnly?: boolean }) => Promise<RetrievalResult[]>;
  retrieveBySourcePath: (sourcePath: string) => Promise<RetrievalResult[]>;
  getSourceChunkInfoByPath: (sourcePath: string) => Promise<RetrievalChunkInfo[]>;
};
