import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
  FtsChunkRow,
  FtsSearchRow,
  IndexChunkRow,
  IndexFileRow,
  IndexJobRow,
  IndexMetadataRepository,
  NewIndexJob,
} from "./index-metadata.repository.types";

const SCHEMA_VERSION = 1;

export function createIndexMetadataRepository(opts: {
  dbPath: string;
}): IndexMetadataRepository {
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath, { create: true });
  migrate(db);

  return {
    close() {
      db.close();
    },

    getSchemaVersion() {
      const row = db
        .query("SELECT value FROM meta WHERE key = 'schema_version'")
        .get() as { value?: string } | null;
      return Number(row?.value ?? 0);
    },

    upsertFile(row: IndexFileRow) {
      db.query(
        `INSERT INTO files (
          file_id, path, size, mtime_ms, inode, status, last_index_time_ms, last_error, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          file_id=excluded.file_id,
          size=excluded.size,
          mtime_ms=excluded.mtime_ms,
          inode=excluded.inode,
          status=excluded.status,
          last_index_time_ms=excluded.last_index_time_ms,
          last_error=excluded.last_error,
          updated_at_ms=excluded.updated_at_ms`,
      ).run(
        row.fileId,
        row.path,
        row.size,
        row.mtimeMs,
        row.inode,
        row.status,
        row.lastIndexTimeMs,
        row.lastError,
        row.createdAtMs,
        row.updatedAtMs,
      );
    },

    getFileByPath(path: string) {
      const row = db
        .query(
          `SELECT
            file_id AS fileId,
            path,
            size,
            mtime_ms AS mtimeMs,
            inode,
            status,
            last_index_time_ms AS lastIndexTimeMs,
            last_error AS lastError,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM files
          WHERE path = ?`,
        )
        .get(path) as IndexFileRow | null;
      return row;
    },

    upsertChunks(rows: IndexChunkRow[]) {
      if (rows.length === 0) {
        return;
      }
      const stmt = db.query(
        `INSERT INTO chunks (
          chunk_id, file_id, source_path, start_offset, end_offset, chunk_hash, token_count, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          file_id=excluded.file_id,
          source_path=excluded.source_path,
          start_offset=excluded.start_offset,
          end_offset=excluded.end_offset,
          chunk_hash=excluded.chunk_hash,
          token_count=excluded.token_count,
          updated_at_ms=excluded.updated_at_ms`,
      );
      const tx = db.transaction((items: IndexChunkRow[]) => {
        for (const row of items) {
          stmt.run(
            row.chunkId,
            row.fileId,
            row.sourcePath,
            row.startOffset,
            row.endOffset,
            row.chunkHash,
            row.tokenCount,
            row.updatedAtMs,
          );
        }
      });
      tx(rows);
    },

    listChunksByFileId(fileId: string) {
      return db
        .query(
          `SELECT
            chunk_id AS chunkId,
            file_id AS fileId,
            source_path AS sourcePath,
            start_offset AS startOffset,
            end_offset AS endOffset,
            chunk_hash AS chunkHash,
            token_count AS tokenCount,
            updated_at_ms AS updatedAtMs
          FROM chunks
          WHERE file_id = ?
          ORDER BY start_offset ASC, chunk_id ASC`,
        )
        .all(fileId) as IndexChunkRow[];
    },

    deleteChunksByIds(chunkIds: string[]) {
      if (chunkIds.length === 0) {
        return;
      }
      const stmt = db.query("DELETE FROM chunks WHERE chunk_id = ?");
      const tx = db.transaction((ids: string[]) => {
        for (const chunkId of ids) {
          stmt.run(chunkId);
        }
      });
      tx(chunkIds);
    },

    upsertFtsChunks(rows: FtsChunkRow[]) {
      if (rows.length === 0) {
        return;
      }
      const deleteStmt = db.query("DELETE FROM fts_chunks WHERE chunk_id = ?");
      const insertStmt = db.query(
        "INSERT INTO fts_chunks (chunk_id, file_id, source_path, text) VALUES (?, ?, ?, ?)",
      );
      const tx = db.transaction((items: FtsChunkRow[]) => {
        for (const row of items) {
          deleteStmt.run(row.chunkId);
          insertStmt.run(row.chunkId, row.fileId, row.sourcePath, row.text);
        }
      });
      tx(rows);
    },

    searchFts(query: string, limit: number) {
      const q = query.trim();
      if (!q) {
        return [];
      }
      return db
        .query(
          `SELECT
            chunk_id AS chunkId,
            file_id AS fileId,
            source_path AS sourcePath,
            bm25(fts_chunks) AS score
          FROM fts_chunks
          WHERE fts_chunks MATCH ?
          ORDER BY score
          LIMIT ?`,
        )
        .all(q, limit) as FtsSearchRow[];
    },

    deleteFtsChunksByIds(chunkIds: string[]) {
      if (chunkIds.length === 0) {
        return;
      }
      const stmt = db.query("DELETE FROM fts_chunks WHERE chunk_id = ?");
      const tx = db.transaction((ids: string[]) => {
        for (const chunkId of ids) {
          stmt.run(chunkId);
        }
      });
      tx(chunkIds);
    },

    enqueueJob(job: NewIndexJob) {
      const nowMs = Date.now();
      db.query(
        `INSERT INTO jobs (
          job_id, path, job_type, status, reason, attempt, error, next_run_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, 'pending', ?, 0, NULL, ?, ?, ?)`,
      ).run(
        job.jobId,
        job.path,
        job.jobType,
        job.reason,
        job.nextRunAtMs,
        nowMs,
        nowMs,
      );
    },

    claimDueJobs(limit: number, nowMs: number) {
      const rows = db
        .query(
          `SELECT
            job_id AS jobId,
            path,
            job_type AS jobType,
            status,
            reason,
            attempt,
            error,
            next_run_at_ms AS nextRunAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM jobs
          WHERE status = 'pending' AND next_run_at_ms <= ?
          ORDER BY next_run_at_ms ASC
          LIMIT ?`,
        )
        .all(nowMs, limit) as IndexJobRow[];
      if (rows.length === 0) {
        return [];
      }
      const updateStmt = db.query(
        `UPDATE jobs
          SET status = 'running', attempt = attempt + 1, updated_at_ms = ?
          WHERE job_id = ?`,
      );
      const tx = db.transaction((items: IndexJobRow[]) => {
        for (const row of items) {
          updateStmt.run(nowMs, row.jobId);
          row.status = "running";
          row.attempt += 1;
          row.updatedAtMs = nowMs;
        }
      });
      tx(rows);
      return rows;
    },

    getJobById(jobId: string) {
      return db
        .query(
          `SELECT
            job_id AS jobId,
            path,
            job_type AS jobType,
            status,
            reason,
            attempt,
            error,
            next_run_at_ms AS nextRunAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM jobs
          WHERE job_id = ?`,
        )
        .get(jobId) as IndexJobRow | null;
    },

    completeJob(jobId: string) {
      db.query(
        "UPDATE jobs SET status = 'done', error = NULL, updated_at_ms = ? WHERE job_id = ?",
      ).run(Date.now(), jobId);
    },

    failJob(jobId: string, error: string) {
      db.query(
        "UPDATE jobs SET status = 'failed', error = ?, updated_at_ms = ? WHERE job_id = ?",
      ).run(error, Date.now(), jobId);
    },

    retryJob(jobId: string, error: string, nextRunAtMs: number) {
      db.query(
        `UPDATE jobs
          SET status = 'pending', error = ?, next_run_at_ms = ?, updated_at_ms = ?
          WHERE job_id = ?`,
      ).run(error, nextRunAtMs, Date.now(), jobId);
    },

    resetRunningJobsToPending() {
      const result = db
        .query(
          "UPDATE jobs SET status = 'pending', updated_at_ms = ? WHERE status = 'running'",
        )
        .run(Date.now());
      return Number(result.changes ?? 0);
    },
  };
}

function migrate(db: Database) {
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA foreign_keys = ON");

  db.exec(
    `CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )`,
  );

  db.exec(
    `CREATE TABLE IF NOT EXISTS files (
      file_id TEXT PRIMARY KEY,
      path TEXT UNIQUE NOT NULL,
      size INTEGER NOT NULL,
      mtime_ms INTEGER NOT NULL,
      inode INTEGER,
      status TEXT NOT NULL,
      last_index_time_ms INTEGER,
      last_error TEXT,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_status ON files(status)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_files_mtime ON files(mtime_ms)");

  db.exec(
    `CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY,
      file_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      chunk_hash TEXT NOT NULL,
      token_count INTEGER,
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY(file_id) REFERENCES files(file_id) ON DELETE CASCADE,
      UNIQUE(file_id, start_offset, end_offset)
    )`,
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id)");
  db.exec("CREATE INDEX IF NOT EXISTS idx_chunks_hash ON chunks(chunk_hash)");

  db.exec(
    `CREATE TABLE IF NOT EXISTS jobs (
      job_id TEXT PRIMARY KEY,
      path TEXT NOT NULL,
      job_type TEXT NOT NULL,
      status TEXT NOT NULL,
      reason TEXT NOT NULL,
      attempt INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      next_run_at_ms INTEGER NOT NULL,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    )`,
  );
  db.exec("CREATE INDEX IF NOT EXISTS idx_jobs_sched ON jobs(status, next_run_at_ms)");

  db.exec(
    `CREATE TABLE IF NOT EXISTS tombstones (
      path TEXT PRIMARY KEY,
      deleted_time_ms INTEGER NOT NULL
    )`,
  );

  db.exec(
    `CREATE VIRTUAL TABLE IF NOT EXISTS fts_chunks USING fts5(
      chunk_id UNINDEXED,
      file_id UNINDEXED,
      source_path UNINDEXED,
      text,
      tokenize='unicode61'
    )`,
  );

  db.query(
    `INSERT INTO meta(key, value) VALUES ('schema_version', ?)
      ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
  ).run(String(SCHEMA_VERSION));
}
