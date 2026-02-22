import type { VectorSearchRow } from "../vector/vector.repository.types";

export type RerankRow = VectorSearchRow;

export type RerankerService = {
  rerank: (query: string, rows: RerankRow[], opts: { topK: number }) => Promise<RerankRow[]>;
};

