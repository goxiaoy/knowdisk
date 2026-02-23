import type {
  RetrievalDeps,
  RetrievalService,
  RetrievalVectorRow,
} from "./retrieval.service.types";

export function createRetrievalService(deps: RetrievalDeps): RetrievalService {
  const mapRow = (row: {
    chunkId: string;
    score: number;
      metadata: {
      title?: string;
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
    async search(query: string, opts: { topK?: number; titleOnly?: boolean }) {
      const startedAt = Date.now();
      const topK = opts.topK ?? deps.defaults.topK;
      const titleOnly = Boolean(opts.titleOnly);
      const singleKeyword = isSingleKeywordQuery(query);
      deps.logger?.debug(
        {
          subsystem: "retrieval",
          query,
          topK,
          titleOnly,
          singleKeyword,
          ftsTopN: deps.defaults.ftsTopN ?? topK,
        },
        "retrieval.search: start",
      );
      const vectorRows = titleOnly
        ? []
        : await searchVector(deps, query, topK);
      const contentFtsRows = titleOnly
        ? []
        : deps.fts?.searchFts(query, deps.defaults.ftsTopN ?? topK) ?? [];
      const titleFtsRows =
        titleOnly || singleKeyword
          ? deps.fts?.searchTitleFts?.(query, deps.defaults.ftsTopN ?? topK) ?? []
          : [];
      const ftsRows: FtsRankRow[] = [
        ...contentFtsRows.map((row) => ({ ...row, kind: "content" as const })),
        ...titleFtsRows.map((row) => ({ ...row, kind: "title" as const })),
      ];
      deps.logger?.debug(
        {
          subsystem: "retrieval",
          query,
          topK,
          titleOnly,
          singleKeyword,
          vectorRows: vectorRows.map((row) => ({
            chunkId: row.chunkId,
            sourcePath: row.metadata.sourcePath,
            score: row.score,
          })),
          ftsRows: ftsRows.map((row) => ({
            chunkId: row.chunkId,
            sourcePath: row.sourcePath,
            score: row.score,
            kind: row.kind,
          })),
        },
        "retrieval.search: raw rows",
      );
      const mergedRows = mergeRows(vectorRows, ftsRows);
      const rerankRows = mergedRows.map((row) => ({
        ...row,
        vector: row.vector ?? [],
      }));
      const finalRows = deps.reranker
        ? await deps.reranker.rerank(query, rerankRows, { topK })
        : rerankRows;
      deps.logger?.debug(
        {
          subsystem: "retrieval",
          query,
          topK,
          titleOnly,
          singleKeyword,
          vectorCount: vectorRows.length,
          ftsCount: ftsRows.length,
          mergedCount: mergedRows.length,
          finalCount: finalRows.length,
          rerankerEnabled: Boolean(deps.reranker),
          latencyMs: Date.now() - startedAt,
        },
        "retrieval.search: done",
      );

      return finalRows.map(mapRow);
    },
    async retrieveBySourcePath(sourcePath: string) {
      const rows = await deps.vector.listBySourcePath(sourcePath);
      return Promise.all(
        rows.map(async (row) => {
          let chunkText = row.metadata.chunkText ?? "";
          if (
            deps.sourceReader &&
            row.metadata.startOffset !== undefined &&
            row.metadata.endOffset !== undefined
          ) {
            try {
              chunkText = await deps.sourceReader.readRange(
                row.metadata.sourcePath,
                row.metadata.startOffset,
                row.metadata.endOffset,
              );
            } catch {
              // fallback to preview from vector metadata
            }
          }
          return mapRow({
            ...row,
            metadata: {
              ...row.metadata,
              chunkText,
            },
          });
        }),
      );
    },
  };
}
type FtsRankRow = {
  chunkId: string;
  sourcePath: string;
  text: string;
  score: number;
  kind: "content" | "title";
};

async function searchVector(
  deps: RetrievalDeps,
  query: string,
  topK: number,
): Promise<RetrievalVectorRow[]> {
  const queryVector = await deps.embedding.embed(query);
  return deps.vector.search(queryVector, { topK });
}

function mergeRows(
  vectorRows: RetrievalVectorRow[],
  ftsRows: FtsRankRow[],
): RetrievalVectorRow[] {
  const merged = new Map<string, RetrievalVectorRow>();
  for (const row of vectorRows) {
    merged.set(row.chunkId, { ...row });
  }

  for (const row of ftsRows) {
    const weight = row.kind === "title" ? 1 : 0.8;
    const weightedScore = normalizeFtsScore(row.score) * weight;
    const existing = merged.get(row.chunkId);
    if (existing) {
      existing.score += weightedScore;
      continue;
    }
    merged.set(row.chunkId, {
      chunkId: row.chunkId,
      score: weightedScore,
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

function isSingleKeywordQuery(query: string) {
  return query.trim().split(/\s+/).filter(Boolean).length === 1;
}
