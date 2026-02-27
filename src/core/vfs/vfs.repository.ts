import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
  ListChildrenPageLocalInput,
  ListChildrenPageLocalOutput,
  VfsMountRow,
  VfsPageCacheRow,
  VfsRepository,
} from "./vfs.repository.types";
import type { VfsChunk, VfsMarkdownCache, VfsNode } from "./vfs.types";

export function createVfsRepository(opts: { dbPath: string }): VfsRepository {
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath, { create: true });
  migrate(db);

  return {
    close() {
      db.close();
    },

    upsertMount(row: VfsMountRow) {
      db.query(
        `INSERT INTO vfs_mounts (
          mount_id, mount_path, provider_type, sync_metadata, sync_content,
          metadata_ttl_sec, reconcile_interval_ms, last_reconcile_at_ms,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mount_id) DO UPDATE SET
          mount_path=excluded.mount_path,
          provider_type=excluded.provider_type,
          sync_metadata=excluded.sync_metadata,
          sync_content=excluded.sync_content,
          metadata_ttl_sec=excluded.metadata_ttl_sec,
          reconcile_interval_ms=excluded.reconcile_interval_ms,
          last_reconcile_at_ms=excluded.last_reconcile_at_ms,
          updated_at_ms=excluded.updated_at_ms`,
      ).run(
        row.mountId,
        row.mountPath,
        row.providerType,
        row.syncMetadata ? 1 : 0,
        row.syncContent,
        row.metadataTtlSec,
        row.reconcileIntervalMs,
        row.lastReconcileAtMs,
        row.createdAtMs,
        row.updatedAtMs,
      );
    },

    getMountById(mountId: string) {
      const row = db
        .query(
          `SELECT
            mount_id AS mountId,
            mount_path AS mountPath,
            provider_type AS providerType,
            sync_metadata AS syncMetadata,
            sync_content AS syncContent,
            metadata_ttl_sec AS metadataTtlSec,
            reconcile_interval_ms AS reconcileIntervalMs,
            last_reconcile_at_ms AS lastReconcileAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_mounts
          WHERE mount_id = ?`,
        )
        .get(mountId) as
        | (Omit<VfsMountRow, "syncMetadata"> & { syncMetadata: number })
        | null;
      if (!row) {
        return null;
      }
      return {
        ...row,
        syncMetadata: row.syncMetadata === 1,
      };
    },

    upsertNodes(rows: VfsNode[]) {
      if (rows.length === 0) {
        return;
      }
      const stmt = db.query(
        `INSERT INTO vfs_nodes (
          node_id, mount_id, parent_id, name, vpath, kind, title,
          size, mtime_ms, source_ref, provider_version, content_hash,
          content_state, deleted_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          mount_id=excluded.mount_id,
          parent_id=excluded.parent_id,
          name=excluded.name,
          vpath=excluded.vpath,
          kind=excluded.kind,
          title=excluded.title,
          size=excluded.size,
          mtime_ms=excluded.mtime_ms,
          source_ref=excluded.source_ref,
          provider_version=excluded.provider_version,
          content_hash=excluded.content_hash,
          content_state=excluded.content_state,
          deleted_at_ms=excluded.deleted_at_ms,
          updated_at_ms=excluded.updated_at_ms`,
      );
      const tx = db.transaction((items: VfsNode[]) => {
        for (const row of items) {
          stmt.run(
            row.nodeId,
            row.mountId,
            row.parentId,
            row.name,
            row.vpath,
            row.kind,
            row.title,
            row.size,
            row.mtimeMs,
            row.sourceRef,
            row.providerVersion,
            row.contentHash,
            row.contentState,
            row.deletedAtMs,
            row.createdAtMs,
            row.updatedAtMs,
          );
        }
      });
      tx(rows);
    },

    listChildrenPageLocal(input: ListChildrenPageLocalInput): ListChildrenPageLocalOutput {
      const { mountId, parentId, limit, cursor } = input;
      const args = [mountId, parentId] as Array<string | null>;
      let cursorClause = "";

      if (cursor) {
        cursorClause = "AND (name > ? OR (name = ? AND node_id > ?))";
        args.push(cursor.lastName, cursor.lastName, cursor.lastNodeId);
      }

      const rows = db
        .query(
          `SELECT
            node_id AS nodeId,
            mount_id AS mountId,
            parent_id AS parentId,
            name,
            vpath,
            kind,
            title,
            size,
            mtime_ms AS mtimeMs,
            source_ref AS sourceRef,
            provider_version AS providerVersion,
            content_hash AS contentHash,
            content_state AS contentState,
            deleted_at_ms AS deletedAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_nodes
          WHERE mount_id = ?
            AND parent_id IS ?
            AND deleted_at_ms IS NULL
            ${cursorClause}
          ORDER BY name ASC, node_id ASC
          LIMIT ?`,
        )
        .all(...args, limit + 1) as VfsNode[];

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      if (!hasMore || items.length === 0) {
        return { items };
      }

      const last = items[items.length - 1];
      return {
        items,
        nextCursor: {
          lastName: last.name,
          lastNodeId: last.nodeId,
        },
      };
    },

    upsertChunks(rows: VfsChunk[]) {
      if (rows.length === 0) {
        return;
      }
      const stmt = db.query(
        `INSERT INTO vfs_chunks (
          chunk_id, node_id, seq, markdown_chunk, token_count, chunk_hash, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunk_id) DO UPDATE SET
          node_id=excluded.node_id,
          seq=excluded.seq,
          markdown_chunk=excluded.markdown_chunk,
          token_count=excluded.token_count,
          chunk_hash=excluded.chunk_hash,
          updated_at_ms=excluded.updated_at_ms`,
      );
      const tx = db.transaction((items: VfsChunk[]) => {
        for (const row of items) {
          stmt.run(
            row.chunkId,
            row.nodeId,
            row.seq,
            row.markdownChunk,
            row.tokenCount,
            row.chunkHash,
            row.updatedAtMs,
          );
        }
      });
      tx(rows);
    },

    listChunksByNodeId(nodeId: string) {
      return db
        .query(
          `SELECT
            chunk_id AS chunkId,
            node_id AS nodeId,
            seq,
            markdown_chunk AS markdownChunk,
            token_count AS tokenCount,
            chunk_hash AS chunkHash,
            updated_at_ms AS updatedAtMs
          FROM vfs_chunks
          WHERE node_id = ?
          ORDER BY seq ASC, chunk_id ASC`,
        )
        .all(nodeId) as VfsChunk[];
    },

    upsertMarkdownCache(row: VfsMarkdownCache) {
      db.query(
        `INSERT INTO vfs_markdown_cache (
          node_id, markdown_full, markdown_hash, generated_by, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          markdown_full=excluded.markdown_full,
          markdown_hash=excluded.markdown_hash,
          generated_by=excluded.generated_by,
          updated_at_ms=excluded.updated_at_ms`,
      ).run(row.nodeId, row.markdownFull, row.markdownHash, row.generatedBy, row.updatedAtMs);
    },

    getMarkdownCache(nodeId: string) {
      return db
        .query(
          `SELECT
            node_id AS nodeId,
            markdown_full AS markdownFull,
            markdown_hash AS markdownHash,
            generated_by AS generatedBy,
            updated_at_ms AS updatedAtMs
          FROM vfs_markdown_cache
          WHERE node_id = ?`,
        )
        .get(nodeId) as VfsMarkdownCache | null;
    },

    upsertPageCache(row: VfsPageCacheRow) {
      db.query(
        `INSERT INTO vfs_page_cache (
          cache_key, items_json, next_cursor, expires_at_ms
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(cache_key) DO UPDATE SET
          items_json=excluded.items_json,
          next_cursor=excluded.next_cursor,
          expires_at_ms=excluded.expires_at_ms`,
      ).run(row.cacheKey, row.itemsJson, row.nextCursor, row.expiresAtMs);
    },

    getPageCacheIfFresh(cacheKey: string, nowMs: number) {
      return db
        .query(
          `SELECT
            cache_key AS cacheKey,
            items_json AS itemsJson,
            next_cursor AS nextCursor,
            expires_at_ms AS expiresAtMs
          FROM vfs_page_cache
          WHERE cache_key = ?
            AND expires_at_ms > ?`,
        )
        .get(cacheKey, nowMs) as VfsPageCacheRow | null;
    },
  };
}

function migrate(db: Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS vfs_mounts (
      mount_id TEXT PRIMARY KEY,
      mount_path TEXT UNIQUE NOT NULL,
      provider_type TEXT NOT NULL,
      sync_metadata INTEGER NOT NULL,
      sync_content TEXT NOT NULL,
      metadata_ttl_sec INTEGER NOT NULL,
      reconcile_interval_ms INTEGER NOT NULL,
      last_reconcile_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vfs_nodes (
      node_id TEXT PRIMARY KEY,
      mount_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      vpath TEXT UNIQUE NOT NULL,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      size INTEGER,
      mtime_ms INTEGER,
      source_ref TEXT NOT NULL,
      provider_version TEXT,
      content_hash TEXT,
      content_state TEXT NOT NULL,
      deleted_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      UNIQUE(mount_id, source_ref)
    );
    CREATE INDEX IF NOT EXISTS idx_vfs_nodes_parent_order
      ON vfs_nodes (mount_id, parent_id, name, node_id);

    CREATE TABLE IF NOT EXISTS vfs_chunks (
      chunk_id TEXT PRIMARY KEY,
      node_id TEXT NOT NULL,
      seq INTEGER NOT NULL,
      markdown_chunk TEXT NOT NULL,
      token_count INTEGER,
      chunk_hash TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      UNIQUE(node_id, seq)
    );
    CREATE INDEX IF NOT EXISTS idx_vfs_chunks_node_seq
      ON vfs_chunks (node_id, seq);

    CREATE TABLE IF NOT EXISTS vfs_markdown_cache (
      node_id TEXT PRIMARY KEY,
      markdown_full TEXT NOT NULL,
      markdown_hash TEXT NOT NULL,
      generated_by TEXT NOT NULL,
      updated_at_ms INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS vfs_page_cache (
      cache_key TEXT PRIMARY KEY,
      items_json TEXT NOT NULL,
      next_cursor TEXT,
      expires_at_ms INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_vfs_page_cache_exp
      ON vfs_page_cache (expires_at_ms);
  `);
}
