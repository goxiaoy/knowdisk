import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ZVecCollectionSchema,
  ZVecCreateAndOpen,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecOpen,
} from "@zvec/zvec";
import { createLoggerService } from "../logger/logger.service";
import type { LoggerService } from "../logger/logger.service.types";
import type {
  VectorCollectionInspect,
  VectorRepository,
  VectorRow,
} from "./vector.repository.types";

type VectorRepositoryOptions = {
  collectionPath: string;
  dimension: number;
  indexType?: "flat" | "hnsw";
  metric?: "cosine" | "ip" | "l2";
  logger?: LoggerService;
};

const VECTOR_FIELD = "embedding";
const MAX_CHUNK_TEXT_CHARS = 120;

export function createVectorRepository(
  opts: VectorRepositoryOptions,
): VectorRepository {
  const logger =
    opts.logger ??
    createLoggerService({
      name: "knowdisk",
      level: process.env.LOG_LEVEL ?? "info",
    });
  const collectionPath = resolve(opts.collectionPath);
  logger.debug(
    {
      subsystem: "vector",
      collectionPath,
      dimension: opts.dimension,
      indexType: opts.indexType ?? "hnsw",
      metric: opts.metric ?? "cosine",
    },
    "createVectorRepository: initializing",
  );
  mkdirSync(dirname(collectionPath), { recursive: true });
  logger.debug(
    { subsystem: "vector", collectionPath },
    "createVectorRepository: ensured directory",
  );
  const schema = new ZVecCollectionSchema({
    name: "knowdisk",
    vectors: {
      name: VECTOR_FIELD,
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: opts.dimension,
      indexParams: {
        indexType:
          opts.indexType === "flat" ? ZVecIndexType.FLAT : ZVecIndexType.HNSW,
        metricType: mapMetric(opts.metric),
      },
    },
    fields: [
      { name: "sourcePath", dataType: ZVecDataType.STRING },
      { name: "title", dataType: ZVecDataType.STRING },
      { name: "chunkText", dataType: ZVecDataType.STRING },
      { name: "startOffset", dataType: ZVecDataType.STRING },
      { name: "endOffset", dataType: ZVecDataType.STRING },
      { name: "tokenEstimate", dataType: ZVecDataType.STRING },
      { name: "updatedAt", dataType: ZVecDataType.STRING },
    ],
  });
  logger.debug(
    { subsystem: "vector", collectionPath },
    "createVectorRepository: schema ready",
  );
  let collection = existsSync(collectionPath)
    ? ZVecOpen(collectionPath)
    : ZVecCreateAndOpen(collectionPath, schema);
  logger.debug(
    { subsystem: "vector", collectionPath, exists: existsSync(collectionPath) },
    "createVectorRepository: collection opened",
  );

  return {
    async destroy() {
      logger.debug(
        { subsystem: "vector", collectionPath },
        "vector.destroy: start",
      );
      collection = recreateCollection(
        collection,
        collectionPath,
        schema,
        logger,
      );
      logger.debug(
        { subsystem: "vector", collectionPath },
        "vector.destroy: done",
      );
    },

    async upsert(input: VectorRow[]) {
      logger.debug(
        { subsystem: "vector", collectionPath, chunkCount: input.length },
        "vector.upsert: start",
      );
      if (input.length === 0) {
        logger.debug(
          { subsystem: "vector", collectionPath },
          "vector.upsert: skipped empty input",
        );
        return;
      }
      await withCollectionSelfHeal("upsert", async () => {
        collection.upsertSync(
          input.map((row) => ({
            id: row.chunkId,
            vectors: { [VECTOR_FIELD]: row.vector },
            fields: {
              sourcePath: row.metadata.sourcePath,
              chunkText: normalizeChunkText(row.metadata.chunkText),
              startOffset:
                row.metadata.startOffset !== undefined
                  ? String(row.metadata.startOffset)
                  : "",
              endOffset:
                row.metadata.endOffset !== undefined
                  ? String(row.metadata.endOffset)
                  : "",
              tokenEstimate:
                row.metadata.tokenEstimate !== undefined
                  ? String(row.metadata.tokenEstimate)
                  : "",
              updatedAt: row.metadata.updatedAt ?? "",
              title: row.metadata.title ?? "",
            },
          })),
        );
      });
      logger.debug(
        { subsystem: "vector", collectionPath, chunkCount: input.length },
        "vector.upsert: done",
      );
    },

    async deleteBySourcePath(sourcePath: string) {
      logger.debug(
        { subsystem: "vector", collectionPath, sourcePath },
        "vector.deleteBySourcePath: start",
      );
      await withCollectionSelfHeal("deleteBySourcePath", async () => {
        collection.deleteByFilterSync(
          `sourcePath = '${escapeFilterValue(sourcePath, logger)}'`,
        );
      });
      logger.debug(
        { subsystem: "vector", collectionPath, sourcePath },
        "vector.deleteBySourcePath: done",
      );
    },

    async listBySourcePath(sourcePath: string) {
      logger.debug(
        { subsystem: "vector", collectionPath, sourcePath },
        "vector.listBySourcePath: start",
      );
      const docs = await withCollectionSelfHeal("listBySourcePath", () =>
        collection.querySync({
          filter: `sourcePath = '${escapeFilterValue(sourcePath, logger)}'`,
          outputFields: [
            "sourcePath",
            "title",
            "chunkText",
            "startOffset",
            "endOffset",
            "tokenEstimate",
            "updatedAt",
          ],
        }),
      );
      const rows = docs
        .map((doc) => ({
          chunkId: doc.id,
          score: Number(doc.score ?? 0),
          vector: [],
          metadata: {
            sourcePath: String(doc.fields.sourcePath ?? ""),
            title: String(doc.fields.title ?? ""),
            chunkText: String(doc.fields.chunkText ?? ""),
            startOffset: parseOptionalNumber(
              doc.fields.startOffset,
              logger,
              "startOffset",
            ),
            endOffset: parseOptionalNumber(
              doc.fields.endOffset,
              logger,
              "endOffset",
            ),
            tokenEstimate: parseOptionalNumber(
              doc.fields.tokenEstimate,
              logger,
              "tokenEstimate",
            ),
            updatedAt: String(doc.fields.updatedAt ?? ""),
          },
        }))
        .sort((left, right) => {
          const l = left.metadata.startOffset ?? Number.MAX_SAFE_INTEGER;
          const r = right.metadata.startOffset ?? Number.MAX_SAFE_INTEGER;
          if (l === r) {
            return left.chunkId.localeCompare(right.chunkId);
          }
          return l - r;
        });
      logger.debug(
        {
          subsystem: "vector",
          collectionPath,
          sourcePath,
          resultCount: rows.length,
        },
        "vector.listBySourcePath: done",
      );
      return rows;
    },

    async search(query: number[], opts: { topK: number }) {
      logger.debug(
        {
          subsystem: "vector",
          collectionPath,
          topK: opts.topK,
          queryDimension: query.length,
        },
        "vector.search: start",
      );
      const docs = await withCollectionSelfHeal("search", () =>
        collection.querySync({
          fieldName: VECTOR_FIELD,
          vector: query,
          topk: opts.topK,
          outputFields: [
            "sourcePath",
            "title",
            "chunkText",
            "startOffset",
            "endOffset",
            "tokenEstimate",
            "updatedAt",
          ],
        }),
      );
      const rows = docs.map((doc) => ({
        chunkId: doc.id,
        score: doc.score,
        vector: [],
          metadata: {
            sourcePath: String(doc.fields.sourcePath ?? ""),
            title: String(doc.fields.title ?? ""),
            chunkText: String(doc.fields.chunkText ?? ""),
          startOffset: parseOptionalNumber(
            doc.fields.startOffset,
            logger,
            "startOffset",
          ),
          endOffset: parseOptionalNumber(
            doc.fields.endOffset,
            logger,
            "endOffset",
          ),
          tokenEstimate: parseOptionalNumber(
            doc.fields.tokenEstimate,
            logger,
            "tokenEstimate",
          ),
          updatedAt: String(doc.fields.updatedAt ?? ""),
        },
      }));
      logger.debug(
        {
          subsystem: "vector",
          collectionPath,
          topK: opts.topK,
          resultCount: rows.length,
        },
        "vector.search: done",
      );
      return rows;
    },

    async inspect() {
      return withCollectionSelfHeal("inspect", () => mapInspect(collection));
    },
  };

  async function withCollectionSelfHeal<T>(
    opName: string,
    op: () => T,
  ): Promise<T> {
    try {
      const result = op();
      return result;
    } catch (error) {
      logger.error(
        { subsystem: "vector", collectionPath, opName, error: String(error) },
        "vector.withCollectionSelfHeal: operation failed",
      );
      if (!isMissingVectorIndexerError(error)) {
        throw error;
      }
      logger.info(
        { subsystem: "vector", collectionPath, opName },
        "vector.withCollectionSelfHeal: missing indexer detected, recreating collection",
      );
      collection = recreateCollection(
        collection,
        collectionPath,
        schema,
        logger,
      );
      const result = op();
      logger.info(
        { subsystem: "vector", collectionPath, opName },
        "vector.withCollectionSelfHeal: success after self-heal",
      );
      return result;
    }
  }
}

function normalizeChunkText(input: string | undefined): string {
  if (!input) {
    return "";
  }
  if (input.length <= MAX_CHUNK_TEXT_CHARS) {
    return input;
  }
  return `${input.slice(0, MAX_CHUNK_TEXT_CHARS)}...`;
}

function mapInspect(
  collection: ReturnType<typeof ZVecOpen>,
): VectorCollectionInspect {
  return {
    path: collection.path,
    option: toRecord(collection.options),
    options: toRecord(collection.options),
    schema: {
      name: collection.schema.name,
      vectors: collection.schema.vectors().map((vector) => ({
        name: vector.name,
        dataType: String(vector.dataType),
        dimension: vector.dimension,
        indexParams: toRecord(vector.indexParams),
      })),
      fields: collection.schema.fields().map((field) => ({
        name: field.name,
        dataType: String(field.dataType),
      })),
    },
    stats: {
      docCount: collection.stats.docCount,
      indexCompleteness: collection.stats.indexCompleteness,
    },
  };
}

function toRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    return {};
  }
  return JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
}

function recreateCollection(
  collection: ReturnType<typeof ZVecOpen>,
  collectionPath: string,
  schema: ZVecCollectionSchema,
  logger: LoggerService,
) {
  logger.debug(
    { subsystem: "vector", collectionPath },
    "vector.recreateCollection: start",
  );
  try {
    collection.destroySync();
    logger.debug(
      { subsystem: "vector", collectionPath },
      "vector.recreateCollection: destroySync success",
    );
  } catch {
    logger.debug(
      { subsystem: "vector", collectionPath },
      "vector.recreateCollection: destroySync failed, trying closeSync",
    );
    try {
      collection.closeSync();
      logger.debug(
        { subsystem: "vector", collectionPath },
        "vector.recreateCollection: closeSync success",
      );
    } catch {
      logger.error(
        { subsystem: "vector", collectionPath },
        "vector.recreateCollection: cleanup failed, continuing with fresh create",
      );
    }
  }
  const recreated = ZVecCreateAndOpen(collectionPath, schema);
  logger.debug(
    { subsystem: "vector", collectionPath },
    "vector.recreateCollection: done",
  );
  return recreated;
}

function isMissingVectorIndexerError(error: unknown) {
  const message = String(error ?? "");
  return message.includes("vector indexer not found for field");
}

function escapeFilterValue(input: string, logger: LoggerService) {
  logger.debug(
    { subsystem: "vector", inputLength: input.length },
    "vector.escapeFilterValue: start",
  );
  return input.split("'").join("''");
}

function parseOptionalNumber(
  input: unknown,
  logger: LoggerService,
  fieldName: string,
): number | undefined {
  const text = String(input ?? "").trim();
  logger.debug(
    { subsystem: "vector", fieldName, raw: text },
    "vector.parseOptionalNumber: start",
  );
  if (!text) {
    logger.debug(
      { subsystem: "vector", fieldName },
      "vector.parseOptionalNumber: empty",
    );
    return undefined;
  }
  const value = Number(text);
  const result = Number.isFinite(value) ? value : undefined;
  logger.debug(
    { subsystem: "vector", fieldName, parsed: result },
    "vector.parseOptionalNumber: done",
  );
  return result;
}

function mapMetric(metric: VectorRepositoryOptions["metric"]) {
  if (metric === "ip") return ZVecMetricType.IP;
  if (metric === "l2") return ZVecMetricType.L2;
  return ZVecMetricType.COSINE;
}
