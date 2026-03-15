import type { ParseChunk } from "@knowdisk/parser";
import type { VfsNode } from "@knowdisk/vfs";
import type { Logger } from "pino";
import type { DependencyContainer } from "tsyringe";

export const INDEXING_TYPES_READY = true;

export type EmbeddingProvider = {
  type: string;
  dimension?: number;
  embed: (text: string) => Promise<number[]>;
  embedBatch?: (texts: string[]) => Promise<number[][]>;
};

export type RerankerProvider = {
  type: string;
  rerank: (
    query: string,
    rows: SearchHit[],
    opts: { topK: number },
  ) => Promise<SearchHit[]>;
};

export type EmbeddingFactory = (
  container: DependencyContainer,
  options?: Record<string, unknown>,
) => EmbeddingProvider;

export type RerankerFactory = (
  container: DependencyContainer,
  options?: Record<string, unknown>,
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

export type CreateIndexingServiceInput = {
  logger: Logger;
  ftsRepository: {
    replaceNodeChunks: (
      rows: Array<{
        chunkId: string;
        nodeId: string;
        mountId: string;
        sourceRef: string;
        name: string;
        title: string | null;
        heading: string | null;
        sectionId: string | null;
        sectionPath: string[];
        text: string;
        markdown: string | null;
        chunkIndex: number;
        tokenEstimate: number | null;
        charStart: number | null;
        charEnd: number | null;
        providerVersion: string | null;
        parserId: string;
        parserVersion: string;
        converterId: string;
        converterVersion: string;
        updatedAt: string;
      }>,
    ) => Promise<void>;
    deleteByNodeId: (nodeId: string) => Promise<void>;
    search: (
      query: string,
      opts: { topK: number; titleOnly?: boolean },
    ) => Promise<SearchHit[]>;
  };
  vectorRepository: {
    replaceNodeChunks: (
      rows: Array<{
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
        tokenEstimate: number | null;
        updatedAt: string;
        embedding: number[];
      }>,
    ) => Promise<void>;
    deleteByNodeId: (nodeId: string) => Promise<void>;
    search: (queryVector: number[], opts: { topK: number }) => Promise<SearchHit[]>;
  };
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
  index: (input: {
    node: VfsNode;
    chunks: AsyncIterable<ParseChunk>;
  }) => Promise<{ indexed: number }>;
  delete: (input: { nodeId: string }) => Promise<void>;
  search: (
    query: string,
    opts?: { topK?: number; titleOnly?: boolean },
  ) => Promise<SearchResultSet>;
};
