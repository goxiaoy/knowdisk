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

export type VectorRow = {
  chunkId: string;
  vector: number[];
  metadata: {
    sourcePath: string;
    chunkText?: string;
    startOffset?: number;
    endOffset?: number;
    tokenEstimate?: number;
    updatedAt?: string;
  };
};

type VectorRepositoryOptions = {
  collectionPath: string;
  dimension: number;
  indexType?: "flat" | "hnsw";
  metric?: "cosine" | "ip" | "l2";
};

const VECTOR_FIELD = "embedding";

export function createVectorRepository(opts: VectorRepositoryOptions) {
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
  const collection = existsSync(collectionPath)
    ? ZVecOpen(collectionPath)
    : ZVecCreateAndOpen(collectionPath, schema);

  return {
    async upsert(input: VectorRow[]) {
      if (input.length === 0) {
        return;
      }
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
    },

    async search(query: number[], opts: { topK: number }) {
      const docs = collection.querySync({
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
      });
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
  };
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
