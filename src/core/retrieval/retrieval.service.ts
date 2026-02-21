export type RetrievalDeps = {
  embedding: {
    embed: (query: string) => Promise<number[]>;
  };
  vector: {
    search: (
      queryVector: number[],
      opts: { topK: number },
    ) => Promise<
      Array<{
        chunkId: string;
        score: number;
        metadata: {
          chunkText: string;
          sourcePath: string;
          updatedAt: string;
        };
      }>
    >;
  };
  defaults: {
    topK: number;
  };
  reranker?: {
    rerank: (
      query: string,
      rows: Array<{
        chunkId: string;
        score: number;
        metadata: {
          chunkText: string;
          sourcePath: string;
          updatedAt: string;
        };
      }>,
      opts: { topK: number },
    ) => Promise<
      Array<{
        chunkId: string;
        score: number;
        metadata: {
          chunkText: string;
          sourcePath: string;
          updatedAt: string;
        };
      }>
    >;
  };
};

export function createRetrievalService(deps: RetrievalDeps) {
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
      }));
    },
  };
}
