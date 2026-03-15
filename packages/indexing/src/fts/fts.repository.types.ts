import type { SearchHit } from "../indexing.types";

export type FtsChunkRow = {
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
};

export type FtsRepository = {
  replaceNodeChunks: (rows: FtsChunkRow[]) => Promise<void>;
  deleteByNodeId: (nodeId: string) => Promise<void>;
  search: (query: string, opts: { topK: number; titleOnly?: boolean }) => Promise<SearchHit[]>;
  close: () => void;
};
