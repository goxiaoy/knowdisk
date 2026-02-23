import type { RetrievalDeps, RetrievalService } from "./retrieval.service.types";
import type { VectorSearchRow } from "../vector/vector.repository.types";

export function createRetrievalService(deps: RetrievalDeps): RetrievalService {
  const mapRow = (row: {
    chunkId: string;
    score: number;
    metadata: {
      chunkText?: string;
      sourcePath: string;
      updatedAt?: string;
      startOffset?: number;
      endOffset?: number;
      tokenEstimate?: number;
    };
  }) => ({
    chunkId: row.chunkId,
    chunkText: row.metadata.chunkText ?? "",
    sourcePath: row.metadata.sourcePath,
    score: row.score,
    updatedAt: row.metadata.updatedAt,
    startOffset: row.metadata.startOffset,
    endOffset: row.metadata.endOffset,
    tokenEstimate: row.metadata.tokenEstimate,
  });

  return {
    async search(query: string, opts: { topK?: number }) {
      const topK = opts.topK ?? deps.defaults.topK;
      const queryVector = await deps.embedding.embed(query);
      const vectorRows = await deps.vector.search(queryVector, {
        topK,
      });
      const ftsRows = deps.fts?.searchFts(query, deps.defaults.ftsTopN ?? topK) ?? [];
      const mergedRows = mergeRows(vectorRows, ftsRows);
      const finalRows = deps.reranker
        ? await deps.reranker.rerank(query, mergedRows, { topK })
        : mergedRows;

      return finalRows.map(mapRow);
    },
    async retrieveBySourcePath(sourcePath: string) {
      const rows = await deps.vector.listBySourcePath(sourcePath);
      return rows.map(mapRow);
    },
  };
}

function mergeRows(vectorRows: VectorSearchRow[], ftsRows: Array<{
  chunkId: string;
  sourcePath: string;
  text: string;
  score: number;
}>): VectorSearchRow[] {
  const merged = new Map<string, VectorSearchRow>();
  for (const row of vectorRows) {
    merged.set(row.chunkId, row);
  }

  for (const row of ftsRows) {
    if (merged.has(row.chunkId)) {
      continue;
    }
    merged.set(row.chunkId, {
      chunkId: row.chunkId,
      score: normalizeFtsScore(row.score),
      vector: [],
      metadata: {
        sourcePath: row.sourcePath,
        chunkText: row.text,
      },
    });
  }
  return Array.from(merged.values());
}

function normalizeFtsScore(score: number) {
  return 1 / (1 + Math.abs(score));
}
