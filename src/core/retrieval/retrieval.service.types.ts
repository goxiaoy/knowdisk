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

export type RetrievalDeps = {
  embedding: EmbeddingProvider;
  vector: {
    search: (query: number[], opts: { topK: number }) => Promise<RetrievalVectorRow[]>;
    listBySourcePath: (sourcePath: string) => Promise<RetrievalVectorRow[]>;
  };
  sourceReader?: {
    readRange: (
      path: string,
      startOffset: number,
      endOffset: number,
    ) => Promise<string>;
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
};
