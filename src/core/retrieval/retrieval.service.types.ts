import type { EmbeddingProvider } from "../embedding/embedding.types";
import type { FtsSearchRow } from "../indexing/metadata/index-metadata.repository.types";
import type { RerankerService } from "../reranker/reranker.types";
import type { VectorRepository } from "../vector/vector.repository.types";

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
  vector: Pick<VectorRepository, "search" | "listBySourcePath">;
  fts?: {
    searchFts: (query: string, limit: number) => FtsSearchRow[];
  };
  defaults: {
    topK: number;
    ftsTopN?: number;
  };
  reranker?: RerankerService;
};

export type RetrievalService = {
  search: (query: string, opts: { topK?: number }) => Promise<RetrievalResult[]>;
  retrieveBySourcePath: (sourcePath: string) => Promise<RetrievalResult[]>;
};
