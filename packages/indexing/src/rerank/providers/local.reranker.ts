import type { DependencyContainer } from "tsyringe";
import type { RerankerProvider, SearchHit } from "../../indexing.types";

export function createLocalRerankerProvider(container: DependencyContainer): RerankerProvider {
  const modelService = resolveModelService(container);

  return {
    type: "local",
    async rerank(query, rows, opts) {
      const runtime = await modelService.getLocalRerankerRuntime();
      const inputs = await runtime.tokenizePairs(
        query,
        rows.map((row) => row.text)
      );
      const scores = await runtime.score(inputs);

      return rows
        .map((row, index) => ({
          ...row,
          score: scores[index] ?? row.score,
          scores: {
            ...row.scores,
            rerank: scores[index] ?? row.score,
          },
        }))
        .sort(compareScoreDescending)
        .slice(0, opts.topK);
    },
  };
}

function resolveModelService(container: DependencyContainer) {
  try {
    return container.resolve<{
      getLocalRerankerRuntime: () => Promise<{
        tokenizePairs: (query: string, docs: string[]) => Promise<Record<string, unknown>>;
        score: (inputs: Record<string, unknown>) => Promise<number[]>;
      }>;
    }>("ModelService");
  } catch {
    throw new Error('Local reranker provider requires "ModelService"');
  }
}

function compareScoreDescending(left: SearchHit, right: SearchHit) {
  if (right.score === left.score) {
    return left.chunkId.localeCompare(right.chunkId);
  }
  return right.score - left.score;
}
