import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { runVfsDbMigrations } from "./migrations";
import type { VfsMountRepository, VfsNodeMountExtRow } from "./vfs.mount.repository.types";

export function createVfsMountRepository(opts: { dbPath: string }): VfsMountRepository {
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath, { create: true });
  runVfsDbMigrations(db);

  return {
    close() {
      db.close();
    },

    upsertNodeMountExt(row: VfsNodeMountExtRow) {
      db.query(
        `INSERT INTO vfs_node_mount_ext (
          node_id, mount_id, provider_type, provider_extra, auto_sync, sync_content,
          metadata_ttl_sec, reconcile_interval_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          mount_id=excluded.mount_id,
          provider_type=excluded.provider_type,
          provider_extra=excluded.provider_extra,
          auto_sync=excluded.auto_sync,
          sync_content=excluded.sync_content,
          metadata_ttl_sec=excluded.metadata_ttl_sec,
          reconcile_interval_ms=excluded.reconcile_interval_ms,
          updated_at_ms=excluded.updated_at_ms`
      ).run(
        row.nodeId,
        row.mountId,
        row.providerType,
        JSON.stringify(row.providerExtra ?? {}),
        row.autoSync === false ? 0 : 1,
        row.syncContent ? 1 : 0,
        row.metadataTtlSec,
        row.reconcileIntervalMs,
        row.createdAtMs,
        row.updatedAtMs
      );
    },

    listNodeMountExts() {
      const rows = db
        .query(
          `SELECT
            node_id AS nodeId,
            mount_id AS mountId,
            provider_type AS providerType,
            provider_extra AS providerExtra,
            auto_sync AS autoSync,
            sync_content AS syncContent,
            metadata_ttl_sec AS metadataTtlSec,
            reconcile_interval_ms AS reconcileIntervalMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_node_mount_ext
          ORDER BY mount_id ASC`
        )
        .all() as Array<
        Omit<VfsNodeMountExtRow, "autoSync" | "syncContent" | "providerExtra"> & {
          autoSync: number | null;
          syncContent: number;
          providerExtra: unknown;
        }
      >;
      return rows.map((row) => ({
        ...row,
        providerExtra: parseProviderExtra(row.providerExtra),
        autoSync: row.autoSync === null ? true : row.autoSync === 1,
        syncContent: row.syncContent === 1,
      }));
    },

    deleteNodeMountExtByMountId(mountId: string) {
      db.query(`DELETE FROM vfs_node_mount_ext WHERE mount_id = ?`).run(mountId);
    },

    getNodeMountExtByMountId(mountId: string) {
      const row = db
        .query(
          `SELECT
            node_id AS nodeId,
            mount_id AS mountId,
            provider_type AS providerType,
            provider_extra AS providerExtra,
            auto_sync AS autoSync,
            sync_content AS syncContent,
            metadata_ttl_sec AS metadataTtlSec,
            reconcile_interval_ms AS reconcileIntervalMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_node_mount_ext
          WHERE mount_id = ?`
        )
        .get(mountId) as
        | (Omit<VfsNodeMountExtRow, "autoSync" | "syncContent" | "providerExtra"> & {
            autoSync: number | null;
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
        autoSync: row.autoSync === null ? true : row.autoSync === 1,
        syncContent: row.syncContent === 1,
      };
    },
  };
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
