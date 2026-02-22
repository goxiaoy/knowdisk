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

export type VectorCollectionInspect = {
  path: string;
  option: Record<string, unknown>;
  options: Record<string, unknown>;
  schema: {
    name: string;
    vectors: Array<{
      name: string;
      dataType: string;
      dimension?: number;
      indexParams: Record<string, unknown>;
    }>;
    fields: Array<{
      name: string;
      dataType: string;
    }>;
  };
  stats: {
    docCount: number;
    indexCompleteness: Record<string, number>;
  };
};

export type VectorRepository = {
  upsert: (input: VectorRow[]) => Promise<void>;
  destroy: () => Promise<void>;
  deleteBySourcePath: (sourcePath: string) => Promise<void>;
  listBySourcePath: (sourcePath: string) => Promise<VectorSearchRow[]>;
  search: (query: number[], opts: { topK: number }) => Promise<VectorSearchRow[]>;
  inspect: () => Promise<VectorCollectionInspect>;
};
