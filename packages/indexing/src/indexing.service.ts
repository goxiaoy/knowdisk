import type { ParseChunk } from "@knowdisk/parser";
import type {
  CreateIndexingServiceInput,
  IndexingService,
  SearchHit,
  SearchResultSet,
} from "./indexing.types";

export function createIndexingService(
  input: CreateIndexingServiceInput,
): IndexingService {
  const embeddingProvider = input.embeddingRegistry.get(
    input.embedding.type,
    input.embedding.options,
  );
  const rerankerProvider =
    input.reranker && input.rerankerRegistry
      ? input.rerankerRegistry.get(input.reranker.type, input.reranker.options)
      : null;

  return {
    async index({ node, chunks }) {
      const validChunks = await collectValidChunks(chunks);
      const indexedAt = new Date().toISOString();

      await Promise.all([
        input.ftsRepository.deleteByNodeId(node.nodeId),
        input.vectorRepository.deleteByNodeId(node.nodeId),
      ]);

      if (validChunks.length === 0) {
        return { indexed: 0 };
      }

      const texts = validChunks.map((chunk) => chunk.text);
      const embeddings = embeddingProvider.embedBatch
        ? await embeddingProvider.embedBatch(texts)
        : await Promise.all(texts.map((text) => embeddingProvider.embed(text)));

      await input.ftsRepository.replaceNodeChunks(
        validChunks.map((chunk) => ({
          chunkId: buildChunkId(node.nodeId, chunk.chunkIndex),
          nodeId: node.nodeId,
          mountId: node.mountId,
          sourceRef: node.sourceRef,
          name: node.name,
          title: chunk.title,
          heading: chunk.heading,
          sectionId: chunk.sectionId,
          sectionPath: chunk.sectionPath,
          text: chunk.text,
          markdown: chunk.markdown,
          chunkIndex: chunk.chunkIndex,
          tokenEstimate: chunk.tokenEstimate,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          providerVersion: node.providerVersion,
          parserId: chunk.parse.parserId,
          parserVersion: chunk.parse.parserVersion,
          converterId: chunk.parse.converterId,
          converterVersion: chunk.parse.converterVersion,
          updatedAt: indexedAt,
        })),
      );

      await input.vectorRepository.replaceNodeChunks(
        validChunks.map((chunk, index) => ({
          chunkId: buildChunkId(node.nodeId, chunk.chunkIndex),
          nodeId: node.nodeId,
          mountId: node.mountId,
          sourceRef: node.sourceRef,
          name: node.name,
          title: chunk.title,
          heading: chunk.heading,
          text: chunk.text,
          chunkIndex: chunk.chunkIndex,
          sectionPath: chunk.sectionPath,
          charStart: chunk.charStart,
          charEnd: chunk.charEnd,
          tokenEstimate: chunk.tokenEstimate,
          updatedAt: indexedAt,
          embedding: embeddings[index] ?? [],
        })),
      );

      return { indexed: validChunks.length };
    },

    async delete({ nodeId }) {
      await Promise.all([
        input.ftsRepository.deleteByNodeId(nodeId),
        input.vectorRepository.deleteByNodeId(nodeId),
      ]);
    },

    async search(query, opts) {
      const normalizedQuery = query.trim();
      const topK = opts?.topK ?? input.defaults?.topK ?? 5;
      const titleOnly = opts?.titleOnly ?? false;

      if (!normalizedQuery) {
        return createEmptyResultSet({
          query: normalizedQuery,
          topK,
          titleOnly,
          embeddingProvider: embeddingProvider.type,
          rerankerProvider: rerankerProvider?.type ?? null,
        });
      }

      const fts = await input.ftsRepository.search(normalizedQuery, {
        topK,
        titleOnly,
      });
      const vector =
        titleOnly
          ? []
          : await input.vectorRepository.search(
              await embeddingProvider.embed(normalizedQuery),
              { topK },
            );
      const hybrid = fuseSearchHits(fts, vector, topK);
      const reranked = rerankerProvider
        ? await rerankerProvider.rerank(normalizedQuery, hybrid, { topK })
        : hybrid;

      return {
        hybrid,
        fts,
        vector,
        reranked,
        meta: {
          query: normalizedQuery,
          topK,
          titleOnly,
          embeddingProvider: embeddingProvider.type,
          rerankerProvider: rerankerProvider?.type ?? null,
        },
      };
    },
  };
}

async function collectValidChunks(
  chunks: AsyncIterable<ParseChunk>,
): Promise<ParseChunk[]> {
  const valid: ParseChunk[] = [];
  for await (const chunk of chunks) {
    if (chunk.status === "ok") {
      valid.push(chunk);
    }
  }
  return valid;
}

function buildChunkId(nodeId: string, chunkIndex: number): string {
  return `${nodeId}:${chunkIndex}`;
}

function fuseSearchHits(
  fts: SearchHit[],
  vector: SearchHit[],
  topK: number,
): SearchHit[] {
  const merged = new Map<string, SearchHit>();

  for (const hit of fts) {
    merged.set(hit.chunkId, {
      ...hit,
      scores: { ...hit.scores },
    });
  }

  for (const hit of vector) {
    const existing = merged.get(hit.chunkId);
    if (existing) {
      const fused = average(
        existing.scores.fts ?? existing.score,
        hit.scores.vector ?? hit.score,
      );
      merged.set(hit.chunkId, {
        ...existing,
        score: fused,
        scores: {
          ...existing.scores,
          ...hit.scores,
          fused,
        },
      });
      continue;
    }

    merged.set(hit.chunkId, {
      ...hit,
      scores: {
        ...hit.scores,
        fused: hit.scores.vector ?? hit.score,
      },
      score: hit.scores.vector ?? hit.score,
    });
  }

  for (const [chunkId, hit] of merged) {
    if (hit.scores.fused === undefined) {
      merged.set(chunkId, {
        ...hit,
        score: hit.scores.fts ?? hit.score,
        scores: {
          ...hit.scores,
          fused: hit.scores.fts ?? hit.score,
        },
      });
    }
  }

  return [...merged.values()]
    .sort((left, right) => {
      if (right.score === left.score) {
        return left.chunkId.localeCompare(right.chunkId);
      }
      return right.score - left.score;
    })
    .slice(0, topK);
}

function average(left: number, right: number): number {
  return (left + right) / 2;
}

function createEmptyResultSet(meta: SearchResultSet["meta"]): SearchResultSet {
  return {
    hybrid: [],
    fts: [],
    vector: [],
    reranked: [],
    meta,
  };
}
