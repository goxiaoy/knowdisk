import type { ParseChunk } from "@knowdisk/parser";
import type { VfsNode } from "@knowdisk/vfs";
import type { Logger } from "pino";

export type CreateIndexingServiceInput = {
  logger: Logger;
};

export type EmbeddingProvider = {
  type: string;
};

export type RerankerProvider = {
  type: string;
};

export type EmbeddingRegistry = {
  register: (providerType: string, provider: EmbeddingProvider) => void;
  get: (providerType: string) => EmbeddingProvider;
  listTypes: () => string[];
};

export type RerankerRegistry = {
  register: (providerType: string, provider: RerankerProvider) => void;
  get: (providerType: string) => RerankerProvider;
  listTypes: () => string[];
};

export type SearchHit = {
  node: VfsNode;
  chunk: ParseChunk;
  scores: Record<string, number | null>;
};

export type SearchResultSet = {
  hits: SearchHit[];
};

export type IndexingService = {
  index: (input: { node: VfsNode; chunks: AsyncIterable<ParseChunk> }) => Promise<number>;
  delete: (input: { nodeId: string }) => Promise<void>;
  search: (input: { query: string }) => Promise<SearchResultSet>;
};
