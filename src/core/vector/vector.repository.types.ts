export type VectorMetadata = {
  sourcePath: string;
  chunkText?: string;
  startOffset?: number;
  endOffset?: number;
  tokenEstimate?: number;
  updatedAt?: string;
};

export type VectorRow = {
  chunkId: string;
  vector: number[];
  metadata: VectorMetadata;
};

export type VectorSearchRow = {
  chunkId: string;
  score: number;
  vector: number[];
  metadata: VectorMetadata;
};

export type VectorRepository = {
  upsert: (input: VectorRow[]) => Promise<void>;
  deleteBySourcePath: (sourcePath: string) => Promise<void>;
  search: (query: number[], opts: { topK: number }) => Promise<VectorSearchRow[]>;
};
