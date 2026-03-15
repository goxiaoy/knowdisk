import type { SearchHit } from "./indexing.types";

export type VectorChunkRow = {
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
};

export type VectorRepository = {
  replaceNodeChunks: (rows: VectorChunkRow[]) => Promise<void>;
  deleteByNodeId: (nodeId: string) => Promise<void>;
  search: (queryVector: number[], opts: { topK: number }) => Promise<SearchHit[]>;
  close: () => void;
};
