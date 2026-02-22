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
import type { VectorCollectionInspect, VectorRepository, VectorRow } from "./vector.repository.types";

type VectorRepositoryOptions = {
  collectionPath: string;
  dimension: number;
  indexType?: "flat" | "hnsw";
  metric?: "cosine" | "ip" | "l2";
};

const VECTOR_FIELD = "embedding";

export function createVectorRepository(opts: VectorRepositoryOptions): VectorRepository {
  const collectionPath = resolve(opts.collectionPath);
  mkdirSync(dirname(collectionPath), { recursive: true });
  const schema = new ZVecCollectionSchema({
    name: "knowdisk",
    vectors: {
      name: VECTOR_FIELD,
      dataType: ZVecDataType.VECTOR_FP32,
      dimension: opts.dimension,
      indexParams: {
        indexType: opts.indexType === "flat" ? ZVecIndexType.FLAT : ZVecIndexType.HNSW,
        metricType: mapMetric(opts.metric),
      },
    },
    fields: [
      { name: "sourcePath", dataType: ZVecDataType.STRING },
      { name: "chunkText", dataType: ZVecDataType.STRING },
      { name: "startOffset", dataType: ZVecDataType.STRING },
      { name: "endOffset", dataType: ZVecDataType.STRING },
      { name: "tokenEstimate", dataType: ZVecDataType.STRING },
      { name: "updatedAt", dataType: ZVecDataType.STRING },
    ],
  });
  let collection = existsSync(collectionPath)
    ? ZVecOpen(collectionPath)
    : ZVecCreateAndOpen(collectionPath, schema);

  return {
    async upsert(input: VectorRow[]) {
      if (input.length === 0) {
        return;
      }
      await withCollectionSelfHeal(async () => {
        collection.upsertSync(
          input.map((row) => ({
            id: row.chunkId,
            vectors: { [VECTOR_FIELD]: row.vector },
            fields: {
              sourcePath: row.metadata.sourcePath,
              chunkText: row.metadata.chunkText ?? "",
              startOffset:
                row.metadata.startOffset !== undefined ? String(row.metadata.startOffset) : "",
              endOffset: row.metadata.endOffset !== undefined ? String(row.metadata.endOffset) : "",
              tokenEstimate:
                row.metadata.tokenEstimate !== undefined
                  ? String(row.metadata.tokenEstimate)
                  : "",
              updatedAt: row.metadata.updatedAt ?? "",
            },
          })),
        );
      });
    },

    async deleteBySourcePath(sourcePath: string) {
      await withCollectionSelfHeal(async () => {
        collection.deleteByFilterSync(`sourcePath = '${escapeFilterValue(sourcePath)}'`);
      });
    },

    async search(query: number[], opts: { topK: number }) {
      const docs = await withCollectionSelfHeal(() =>
        collection.querySync({
          fieldName: VECTOR_FIELD,
          vector: query,
          topk: opts.topK,
          outputFields: [
            "sourcePath",
            "chunkText",
            "startOffset",
            "endOffset",
            "tokenEstimate",
            "updatedAt",
          ],
        }),
      );
      return docs.map((doc) => ({
        chunkId: doc.id,
        score: doc.score,
        vector: [],
        metadata: {
          sourcePath: String(doc.fields.sourcePath ?? ""),
          chunkText: String(doc.fields.chunkText ?? ""),
          startOffset: parseOptionalNumber(doc.fields.startOffset),
          endOffset: parseOptionalNumber(doc.fields.endOffset),
          tokenEstimate: parseOptionalNumber(doc.fields.tokenEstimate),
          updatedAt: String(doc.fields.updatedAt ?? ""),
        },
      }));
    },

    async inspect() {
      return withCollectionSelfHeal(() => mapInspect(collection));
    },
  };

  async function withCollectionSelfHeal<T>(op: () => T): Promise<T> {
    try {
      return op();
    } catch (error) {
      if (!isMissingVectorIndexerError(error)) {
        throw error;
      }
      collection = recreateCollection(collection, collectionPath, schema);
      return op();
    }
  }
}

function mapInspect(collection: ReturnType<typeof ZVecOpen>): VectorCollectionInspect {
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
) {
  try {
    collection.destroySync();
  } catch {
    try {
      collection.closeSync();
    } catch {
      // ignore cleanup errors and attempt fresh create
    }
  }
  return ZVecCreateAndOpen(collectionPath, schema);
}

function isMissingVectorIndexerError(error: unknown) {
  const message = String(error ?? "");
  return message.includes("vector indexer not found for field");
}

function escapeFilterValue(input: string) {
  return input.replaceAll("'", "''");
}

function parseOptionalNumber(input: unknown): number | undefined {
  const text = String(input ?? "").trim();
  if (!text) {
    return undefined;
  }
  const value = Number(text);
  return Number.isFinite(value) ? value : undefined;
}

function mapMetric(metric: VectorRepositoryOptions["metric"]) {
  if (metric === "ip") return ZVecMetricType.IP;
  if (metric === "l2") return ZVecMetricType.L2;
  return ZVecMetricType.COSINE;
}
