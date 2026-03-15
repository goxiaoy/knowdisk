import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type { SearchHit } from "../indexing.types";
import type { FtsChunkRow, FtsRepository } from "./fts.repository.types";

export function createFtsRepository(opts: { dbPath: string }): FtsRepository {
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath, { create: true });
  migrate(db);

  return {
    async replaceNodeChunks(rows) {
      if (rows.length === 0) {
        return;
      }
      const deleteStmt = db.query("DELETE FROM index_chunks WHERE chunk_id = ?");
      const insertStmt = db.query(
        `INSERT INTO index_chunks (
          chunk_id, node_id, mount_id, source_ref, name, title, heading, section_id,
          section_path_json, text, markdown, chunk_index, token_estimate, char_start,
          char_end, provider_version, parser_id, parser_version, converter_id,
          converter_version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const tx = db.transaction((items: FtsChunkRow[]) => {
        for (const row of items) {
          deleteStmt.run(row.chunkId);
          insertStmt.run(
            row.chunkId,
            row.nodeId,
            row.mountId,
            row.sourceRef,
            row.name,
            row.title,
            row.heading,
            row.sectionId,
            JSON.stringify(row.sectionPath),
            row.text,
            row.markdown,
            row.chunkIndex,
            row.tokenEstimate,
            row.charStart,
            row.charEnd,
            row.providerVersion,
            row.parserId,
            row.parserVersion,
            row.converterId,
            row.converterVersion,
            row.updatedAt
          );
        }
      });
      tx(rows);
    },

    async deleteByNodeId(nodeId) {
      db.query("DELETE FROM index_chunks WHERE node_id = ?").run(nodeId);
    },

    async search(query, opts) {
      const normalized = query.trim();
      if (!normalized) {
        return [];
      }
      const column = opts.titleOnly ? "title_terms" : "body_terms";
      const rows = db
        .query(
          `SELECT
            chunk_id AS chunkId,
            node_id AS nodeId,
            mount_id AS mountId,
            source_ref AS sourceRef,
            name,
            title,
            heading,
            text,
            chunk_index AS chunkIndex,
            section_path_json AS sectionPathJson,
            char_start AS charStart,
            char_end AS charEnd,
            bm25(index_chunks_fts) AS rawScore
          FROM index_chunks_fts
          JOIN index_chunks ON index_chunks.rowid = index_chunks_fts.rowid
          WHERE index_chunks_fts MATCH ?
          ORDER BY rawScore
          LIMIT ?`
        )
        .all(`${column}:${buildMatchQuery(normalized)}`, opts.topK) as Array<{
        chunkId: string;
        nodeId: string;
        mountId: string;
        sourceRef: string;
        name: string;
        title: string | null;
        heading: string | null;
        text: string;
        chunkIndex: number;
        sectionPathJson: string;
        charStart: number | null;
        charEnd: number | null;
        rawScore: number;
      }>;

      return rows.map((row) => toSearchHit(row, row.rawScore));
    },

    close() {
      db.close();
    },
  };
}

function toSearchHit(
  row: {
    chunkId: string;
    nodeId: string;
    mountId: string;
    sourceRef: string;
    name: string;
    title: string | null;
    heading: string | null;
    text: string;
    chunkIndex: number;
    sectionPathJson: string;
    charStart: number | null;
    charEnd: number | null;
  },
  rawScore: number
): SearchHit {
  const normalizedScore = rawScore === 0 ? 1 : 1 / (1 + Math.abs(rawScore));
  return {
    chunkId: row.chunkId,
    nodeId: row.nodeId,
    mountId: row.mountId,
    sourceRef: row.sourceRef,
    name: row.name,
    title: row.title,
    heading: row.heading,
    text: row.text,
    chunkIndex: row.chunkIndex,
    sectionPath: JSON.parse(row.sectionPathJson) as string[],
    charStart: row.charStart,
    charEnd: row.charEnd,
    score: normalizedScore,
    scores: {
      fts: normalizedScore,
    },
  };
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS index_chunks (
      chunk_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      mount_id TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      name TEXT NOT NULL,
      title TEXT,
      heading TEXT,
      section_id TEXT,
      section_path_json TEXT NOT NULL,
      text TEXT NOT NULL,
      markdown TEXT,
      chunk_index INTEGER NOT NULL,
      token_estimate INTEGER,
      char_start INTEGER,
      char_end INTEGER,
      provider_version TEXT,
      parser_id TEXT NOT NULL,
      parser_version TEXT NOT NULL,
      converter_id TEXT NOT NULL,
      converter_version TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS index_chunks_fts USING fts5(
      body_terms,
      title_terms,
      content='index_chunks',
      content_rowid='rowid'
    );
    CREATE TRIGGER IF NOT EXISTS index_chunks_ai AFTER INSERT ON index_chunks BEGIN
      INSERT INTO index_chunks_fts(rowid, body_terms, title_terms)
      VALUES (
        new.rowid,
        COALESCE(new.text, ''),
        trim(COALESCE(new.title, '') || ' ' || COALESCE(new.name, '') || ' ' || COALESCE(new.source_ref, ''))
      );
    END;
    CREATE TRIGGER IF NOT EXISTS index_chunks_ad AFTER DELETE ON index_chunks BEGIN
      INSERT INTO index_chunks_fts(index_chunks_fts, rowid, body_terms, title_terms)
      VALUES('delete', old.rowid, old.text, trim(COALESCE(old.title, '') || ' ' || COALESCE(old.name, '') || ' ' || COALESCE(old.source_ref, '')));
    END;
    CREATE TRIGGER IF NOT EXISTS index_chunks_au AFTER UPDATE ON index_chunks BEGIN
      INSERT INTO index_chunks_fts(index_chunks_fts, rowid, body_terms, title_terms)
      VALUES('delete', old.rowid, old.text, trim(COALESCE(old.title, '') || ' ' || COALESCE(old.name, '') || ' ' || COALESCE(old.source_ref, '')));
      INSERT INTO index_chunks_fts(rowid, body_terms, title_terms)
      VALUES (
        new.rowid,
        COALESCE(new.text, ''),
        trim(COALESCE(new.title, '') || ' ' || COALESCE(new.name, '') || ' ' || COALESCE(new.source_ref, ''))
      );
    END;
  `);
}

function buildMatchQuery(query: string): string {
  return query
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}
