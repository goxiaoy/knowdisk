import { isParserSupportedFile, type ParseChunk } from "@knowdisk/parser";
import { createHash } from "node:crypto";
import type {
  CreateIndexingServiceInput,
  IndexingService,
  IndexingStatus,
  SearchHit,
  SearchResultSet,
} from "./indexing.types";

export function createIndexingService(input: CreateIndexingServiceInput): IndexingService {
  const embeddingProvider = input.embeddingRegistry.get(
    input.embedding.type,
    input.embedding.options
  );
  const rerankerProvider =
    input.reranker && input.rerankerRegistry
      ? input.rerankerRegistry.get(input.reranker.type, input.reranker.options)
      : null;
  const listeners = new Set<(status: IndexingStatus) => void>();
  let snapshot: IndexingStatus = {
    phase: "idle",
    scope: null,
    processedFiles: 0,
    totalFiles: 0,
    activeNodeName: null,
    error: "",
  };

  const setStatus = (next: IndexingStatus) => {
    snapshot = next;
    for (const listener of listeners) {
      listener(snapshot);
    }
  };

  const withIdle = (processedFiles: number, totalFiles: number) => {
    setStatus({
      phase: "idle",
      scope: null,
      processedFiles,
      totalFiles,
      activeNodeName: null,
      error: "",
    });
  };

  return {
    async indexNode({ nodeId }) {
      const node = await input.vfs.getMetadata({ id: nodeId });
      if (!node || node.kind !== "file" || !isParserSupportedFile(node)) {
        return { indexed: 0 };
      }
      setStatus({
        phase: "indexing",
        scope: "incremental",
        processedFiles: 0,
        totalFiles: 1,
        activeNodeName: node.name,
        error: "",
      });
      try {
        const result = await indexParsedNode(node, input.parser.parseNode({ nodeId: node.nodeId }));
        withIdle(1, 1);
        return result;
      } catch (error) {
        setStatus({
          phase: "error",
          scope: "incremental",
          processedFiles: 0,
          totalFiles: 1,
          activeNodeName: node.name,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    async deleteNode({ nodeId }) {
      await Promise.all([
        input.parser.clear({ nodeId }),
        input.ftsRepository.deleteByNodeId(nodeId),
        input.vectorRepository.deleteByNodeId(nodeId),
      ]);
    },

    async rebuildAllFromLocalNodes() {
      const files = await collectIndexableNodes();
      setStatus({
        phase: "rebuilding",
        scope: "full",
        processedFiles: 0,
        totalFiles: files.length,
        activeNodeName: null,
        error: "",
      });

      let processedFiles = 0;
      try {
        for (const node of files) {
          setStatus({
            phase: "rebuilding",
            scope: "full",
            processedFiles,
            totalFiles: files.length,
            activeNodeName: node.name,
            error: "",
          });
          try {
            await indexParsedNode(node, input.parser.parseNode({ nodeId: node.nodeId }));
          } catch (error) {
            input.logger.error(
              {
                nodeId: node.nodeId,
                error: error instanceof Error ? error.message : String(error),
              },
              "failed to rebuild index for node"
            );
          }
          processedFiles += 1;
        }
        withIdle(processedFiles, files.length);
      } catch (error) {
        setStatus({
          phase: "error",
          scope: "full",
          processedFiles,
          totalFiles: files.length,
          activeNodeName: null,
          error: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },

    getStatus() {
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) {
          listeners.add(listener);
          return () => {
            listeners.delete(listener);
          };
        },
      };
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
      const vector = titleOnly
        ? []
        : await input.vectorRepository.search(await embeddingProvider.embed(normalizedQuery), {
            topK,
          });
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

  async function collectIndexableNodes() {
    const files: Awaited<ReturnType<typeof input.vfs.getMetadata>>[] = [];
    const queue: Array<string | null> = [null];

    while (queue.length > 0) {
      const parentNodeId = queue.shift() ?? null;
      let cursor: unknown;
      do {
        const page = await input.vfs.walkChildren({
          parentNodeId,
          limit: 200,
          cursor,
        });
        for (const node of page.items) {
          if (node.kind === "mount" || node.kind === "folder") {
            queue.push(node.nodeId);
            continue;
          }
          if (node.kind === "file" && isParserSupportedFile(node)) {
            files.push(node);
          }
        }
        cursor = page.nextCursor;
      } while (cursor);
    }

    return files;
  }

  async function indexParsedNode(node: NonNullable<Awaited<ReturnType<typeof input.vfs.getMetadata>>>, chunks: AsyncIterable<ParseChunk>) {
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
      }))
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
      }))
    );

    return { indexed: validChunks.length };
  }
}

async function collectValidChunks(chunks: AsyncIterable<ParseChunk>): Promise<ParseChunk[]> {
  const valid: ParseChunk[] = [];
  for await (const chunk of chunks) {
    if (chunk.status === "ok") {
      valid.push(chunk);
    }
  }
  return valid;
}

function buildChunkId(nodeId: string, chunkIndex: number): string {
  return createHash("sha1").update(`${nodeId}:${chunkIndex}`).digest("hex");
}

function fuseSearchHits(fts: SearchHit[], vector: SearchHit[], topK: number): SearchHit[] {
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
      const fused = average(existing.scores.fts ?? existing.score, hit.scores.vector ?? hit.score);
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
