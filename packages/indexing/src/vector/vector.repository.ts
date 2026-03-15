import { existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  ZVecCollection,
  ZVecCollectionSchema,
  ZVecCreateAndOpen,
  ZVecDataType,
  ZVecIndexType,
  ZVecMetricType,
  ZVecOpen,
} from "@zvec/zvec";
import type { SearchHit } from "../indexing.types";
import type { VectorChunkRow, VectorRepository } from "./vector.repository.types";

const VECTOR_FIELD = "embedding";

export function createVectorRepository(opts: {
  collectionPath: string;
}): VectorRepository {
  const collectionPath = resolve(opts.collectionPath);
  mkdirSync(dirname(collectionPath), { recursive: true });
  let collection = existsSync(collectionPath) ? ZVecOpen(collectionPath) : null;
  let currentDimension: number | null = null;

  return {
    async replaceNodeChunks(rows) {
      if (rows.length === 0) {
        return;
      }
      const dimensions = new Set(rows.map((row) => row.embedding.length));
      if (dimensions.size > 1) {
        throw new Error("Mixed embedding dimensions are not supported");
      }
      const dimension = rows[0]!.embedding.length;
      if (!collection) {
        collection = ZVecCreateAndOpen(collectionPath, createSchema(dimension));
        currentDimension = dimension;
      } else {
        if (currentDimension !== null && currentDimension !== dimension) {
          throw new Error(
            `Embedding dimension mismatch: expected ${currentDimension}, received ${dimension}`,
          );
        }
        currentDimension = dimension;
      }

      collection.upsertSync(
        rows.map((row) => ({
          id: row.chunkId,
          vectors: {
            [VECTOR_FIELD]: row.embedding,
          },
          fields: {
            nodeId: row.nodeId,
            mountId: row.mountId,
            sourceRef: row.sourceRef,
            name: row.name,
            title: row.title ?? "",
            heading: row.heading ?? "",
            text: row.text,
            chunkIndex: String(row.chunkIndex),
            sectionPath: JSON.stringify(row.sectionPath),
            charStart: row.charStart === null ? "" : String(row.charStart),
            charEnd: row.charEnd === null ? "" : String(row.charEnd),
            tokenEstimate:
              row.tokenEstimate === null ? "" : String(row.tokenEstimate),
            updatedAt: row.updatedAt,
          },
        })),
      );
    },

    async deleteByNodeId(nodeId) {
      if (!collection) {
        return;
      }
      collection.deleteByFilterSync(`nodeId = '${escapeFilterValue(nodeId)}'`);
    },

    async search(queryVector, opts) {
      if (!collection) {
        return [];
      }
      if (currentDimension !== null && currentDimension !== queryVector.length) {
        throw new Error(
          `Query vector dimension mismatch: expected ${currentDimension}, received ${queryVector.length}`,
        );
      }
      const rows = collection.querySync({
        fieldName: VECTOR_FIELD,
        vector: queryVector,
        topk: opts.topK,
        outputFields: [
          "nodeId",
          "mountId",
          "sourceRef",
          "name",
          "title",
          "heading",
          "text",
          "chunkIndex",
          "sectionPath",
          "charStart",
          "charEnd",
          "tokenEstimate",
          "updatedAt",
        ],
      });

      return rows.map((row) => toSearchHit(row));
    },

    close() {
      collection?.closeSync();
      collection = null;
      currentDimension = null;
    },
  };
}

function createSchema(dimension: number): ZVecCollectionSchema {
  return new ZVecCollectionSchema({
    name: "knowdisk_indexing",
    vectors: {
      name: VECTOR_FIELD,
      dataType: ZVecDataType.VECTOR_FP32,
      dimension,
      indexParams: {
        indexType: ZVecIndexType.FLAT,
        metricType: ZVecMetricType.IP,
      },
    },
    fields: [
      { name: "nodeId", dataType: ZVecDataType.STRING },
      { name: "mountId", dataType: ZVecDataType.STRING },
      { name: "sourceRef", dataType: ZVecDataType.STRING },
      { name: "name", dataType: ZVecDataType.STRING },
      { name: "title", dataType: ZVecDataType.STRING },
      { name: "heading", dataType: ZVecDataType.STRING },
      { name: "text", dataType: ZVecDataType.STRING },
      { name: "chunkIndex", dataType: ZVecDataType.STRING },
      { name: "sectionPath", dataType: ZVecDataType.STRING },
      { name: "charStart", dataType: ZVecDataType.STRING },
      { name: "charEnd", dataType: ZVecDataType.STRING },
      { name: "tokenEstimate", dataType: ZVecDataType.STRING },
      { name: "updatedAt", dataType: ZVecDataType.STRING },
    ],
  });
}

function toSearchHit(row: {
  id: string;
  score?: number;
  fields: Record<string, unknown>;
}): SearchHit {
  const score = Number(row.score ?? 0);
  return {
    chunkId: row.id,
    nodeId: String(row.fields.nodeId ?? ""),
    mountId: String(row.fields.mountId ?? ""),
    sourceRef: String(row.fields.sourceRef ?? ""),
    name: String(row.fields.name ?? ""),
    title: normalizeNullableString(row.fields.title),
    heading: normalizeNullableString(row.fields.heading),
    text: String(row.fields.text ?? ""),
    chunkIndex: Number(row.fields.chunkIndex ?? 0),
    sectionPath: parseSectionPath(row.fields.sectionPath),
    charStart: parseOptionalNumber(row.fields.charStart),
    charEnd: parseOptionalNumber(row.fields.charEnd),
    score,
    scores: {
      vector: score,
    },
  };
}

function parseSectionPath(value: unknown): string[] {
  if (typeof value !== "string" || value.length === 0) {
    return [];
  }
  return JSON.parse(value) as string[];
}

function parseOptionalNumber(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeNullableString(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) {
    return null;
  }
  return value;
}

function escapeFilterValue(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("'", "\\'");
}
