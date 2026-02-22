import type { RetrievalDeps, RetrievalService } from "./retrieval.service.types";

export function createRetrievalService(deps: RetrievalDeps): RetrievalService {
  return {
    async search(query: string, opts: { topK?: number }) {
      const queryVector = await deps.embedding.embed(query);
      const rows = await deps.vector.search(queryVector, {
        topK: opts.topK ?? deps.defaults.topK,
      });
      const finalRows = deps.reranker
        ? await deps.reranker.rerank(query, rows, { topK: opts.topK ?? deps.defaults.topK })
        : rows;

      return finalRows.map((row) => ({
        chunkId: row.chunkId,
        chunkText: row.metadata.chunkText,
        sourcePath: row.metadata.sourcePath,
        score: row.score,
        updatedAt: row.metadata.updatedAt,
        startOffset: row.metadata.startOffset,
        endOffset: row.metadata.endOffset,
        tokenEstimate: row.metadata.tokenEstimate,
      }));
    },
  };
}
