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
import type { VfsNode } from "./vfs.types";

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
          mount_id, mount_path, provider_type, provider_extra, sync_metadata, sync_content,
          metadata_ttl_sec, reconcile_interval_ms, last_reconcile_at_ms,
          created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(mount_id) DO UPDATE SET
          mount_path=excluded.mount_path,
          provider_type=excluded.provider_type,
          provider_extra=excluded.provider_extra,
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
        JSON.stringify(row.providerExtra ?? {}),
        row.syncMetadata ? 1 : 0,
        row.syncContent ? 1 : 0,
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
            provider_extra AS providerExtra,
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
        | (Omit<VfsMountRow, "syncMetadata" | "syncContent" | "providerExtra"> & {
            syncMetadata: number;
            syncContent: number;
            providerExtra: unknown;
          })
        | null;
      if (!row) {
        return null;
      }
      return {
        ...row,
        providerExtra: parseProviderExtra(row.providerExtra),
        syncMetadata: row.syncMetadata === 1,
        syncContent: row.syncContent === 1,
      };
    },

    upsertNodes(rows: VfsNode[]) {
      if (rows.length === 0) {
        return;
      }
      const stmt = db.query(
        `INSERT INTO vfs_nodes (
          node_id, mount_id, parent_id, name, vpath, kind, title,
          size, mtime_ms, source_ref, provider_version,
          deleted_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            row.deletedAtMs,
            row.createdAtMs,
            row.updatedAtMs,
          );
        }
      });
      tx(rows);
    },

    listNodesByMountId(mountId: string) {
      return db
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
            deleted_at_ms AS deletedAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_nodes
          WHERE mount_id = ?`,
        )
        .all(mountId) as VfsNode[];
    },

    getNodeByVpath(vpath: string) {
      return db
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
            deleted_at_ms AS deletedAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_nodes
          WHERE vpath = ?
            AND deleted_at_ms IS NULL`,
        )
        .get(vpath) as VfsNode | null;
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
      provider_extra TEXT NOT NULL,
      sync_metadata INTEGER NOT NULL,
      sync_content INTEGER NOT NULL DEFAULT 0,
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
      deleted_at_ms INTEGER,
      created_at_ms INTEGER NOT NULL,
      updated_at_ms INTEGER NOT NULL,
      UNIQUE(mount_id, source_ref)
    );
    CREATE INDEX IF NOT EXISTS idx_vfs_nodes_parent_order
      ON vfs_nodes (mount_id, parent_id, name, node_id);

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

function parseProviderExtra(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string") {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    return {};
  }
  return {};
}
