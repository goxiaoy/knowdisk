import type { ParseChunk, ParserService } from "@knowdisk/parser";
import type { VfsNode, VfsService } from "@knowdisk/vfs";
import type { Logger } from "pino";
import type { DependencyContainer } from "tsyringe";
import type { FtsRepository } from "./fts";
import type { VectorRepository } from "./vector";

export const INDEXING_TYPES_READY = true;

export type EmbeddingProvider = {
  type: string;
  dimension?: number;
  embed: (text: string) => Promise<number[]>;
  embedBatch?: (texts: string[]) => Promise<number[][]>;
};

export type RerankerProvider = {
  type: string;
  rerank: (query: string, rows: SearchHit[], opts: { topK: number }) => Promise<SearchHit[]>;
};

export type EmbeddingFactory = (
  container: DependencyContainer,
  options?: Record<string, unknown>
) => EmbeddingProvider;

export type RerankerFactory = (
  container: DependencyContainer,
  options?: Record<string, unknown>
) => RerankerProvider;

export type EmbeddingRegistry = {
  register: (providerType: string, factory: EmbeddingFactory) => void;
  get: (providerType: string, options?: Record<string, unknown>) => EmbeddingProvider;
  listTypes: () => string[];
};

export type RerankerRegistry = {
  register: (providerType: string, factory: RerankerFactory) => void;
  get: (providerType: string, options?: Record<string, unknown>) => RerankerProvider;
  listTypes: () => string[];
};

export type SearchHit = {
  chunkId: string;
  nodeId: string;
  mountId: string;
  sourceRef: string;
  name: string;
  title: string | null;
  heading: string | null;
  text: string;
  chunkIndex: number;
  sectionPath: string[];
  charStart: number | null;
  charEnd: number | null;
  score: number;
  scores: {
    fts?: number;
    vector?: number;
    fused?: number;
    rerank?: number;
  };
};

export type SearchResultSet = {
  hybrid: SearchHit[];
  fts: SearchHit[];
  vector: SearchHit[];
  reranked: SearchHit[];
  meta: {
    query: string;
    topK: number;
    titleOnly: boolean;
    embeddingProvider: string;
    rerankerProvider: string | null;
  };
};

export type IndexingStatus = {
  phase: "idle" | "indexing" | "rebuilding" | "error";
  scope: "incremental" | "full" | null;
  processedFiles: number;
  totalFiles: number;
  activeNodeName: string | null;
  error: string;
};

export type CreateIndexingServiceInput = {
  logger: Logger;
  parser: Pick<ParserService, "parseNode" | "clear">;
  vfs: Pick<VfsService, "getMetadata" | "walkChildren">;
  ftsRepository: FtsRepository;
  vectorRepository: Pick<VectorRepository, "replaceNodeChunks" | "deleteByNodeId" | "search">;
  embeddingRegistry: EmbeddingRegistry;
  rerankerRegistry?: RerankerRegistry;
  embedding: {
    type: string;
    options?: Record<string, unknown>;
  };
  reranker?: {
    type: string;
    options?: Record<string, unknown>;
  } | null;
  defaults?: {
    topK?: number;
  };
};

export type IndexingService = {
  indexNode: (input: { nodeId: string }) => Promise<{ indexed: number }>;
  deleteNode: (input: { nodeId: string }) => Promise<void>;
  rebuildAllFromLocalNodes: () => Promise<void>;
  getStatus: () => {
    getSnapshot: () => IndexingStatus;
    subscribe: (listener: (status: IndexingStatus) => void) => () => void;
  };
  search: (
    query: string,
    opts?: { topK?: number; titleOnly?: boolean }
  ) => Promise<SearchResultSet>;
};
