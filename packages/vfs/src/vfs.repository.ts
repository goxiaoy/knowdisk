import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import { runVfsDbMigrations } from "./migrations";
import type {
  ListNodeEventsInput,
  ListChildrenPageLocalInput,
  ListChildrenPageLocalOutput,
  VfsNodeEventRow,
  VfsRepository,
} from "./vfs.repository.types";
import type { VfsNodeMountExtRow } from "./vfs.mount.repository.types";
import type { VfsNode } from "./vfs.types";

export function createVfsRepository(opts: { dbPath: string }): VfsRepository {
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath, { create: true });
  runVfsDbMigrations(db);
  const nodeChangesListeners = new Set<(row: VfsNode) => void>();
  const nodeEventsChangedListeners = new Set<(mountId: string) => void>();

  return {
    close() {
      db.close();
    },

    subscribeNodeChanges(listener) {
      nodeChangesListeners.add(listener);
      return () => {
        nodeChangesListeners.delete(listener);
      };
    },

    subscribeNodeEventsChanged(listener) {
      nodeEventsChangedListeners.add(listener);
      return () => {
        nodeEventsChangedListeners.delete(listener);
      };
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

    upsertNodes(rows: VfsNode[]) {
      if (rows.length === 0) {
        return;
      }
      const normalizedRows = rows.map(normalizeNodeRow);
      const stmt = db.query(
        `INSERT INTO vfs_nodes (
          node_id, mount_id, mount_node_id, parent_id, name, kind, type, origin,
          size, mtime_ms, source_ref, provider_version,
          deleted_at_ms, created_at_ms, updated_at_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(node_id) DO UPDATE SET
          mount_id=excluded.mount_id,
          mount_node_id=excluded.mount_node_id,
          parent_id=excluded.parent_id,
          name=excluded.name,
          kind=excluded.kind,
          type=excluded.type,
          origin=excluded.origin,
          size=excluded.size,
          mtime_ms=excluded.mtime_ms,
          source_ref=excluded.source_ref,
          provider_version=excluded.provider_version,
          deleted_at_ms=excluded.deleted_at_ms,
          updated_at_ms=excluded.updated_at_ms`
      );
      const tx = db.transaction((items: VfsNode[]) => {
        for (const row of items) {
          stmt.run(
            row.nodeId,
            row.mountId,
            row.mountNodeId,
            row.parentId,
            row.name,
            row.kind,
            row.type,
            row.origin,
            row.size,
            row.mtimeMs,
            row.sourceRef,
            row.providerVersion,
            row.deletedAtMs,
            row.createdAtMs,
            row.updatedAtMs
          );
        }
      });
      tx(normalizedRows);
      if (nodeChangesListeners.size > 0) {
        for (const row of normalizedRows) {
          for (const listener of nodeChangesListeners) {
            listener(row);
          }
        }
      }
    },

    listNodesByMountNodeId(mountNodeId: string) {
      return db
        .query(
          `SELECT
            node_id AS nodeId,
            mount_id AS mountId,
            mount_node_id AS mountNodeId,
            parent_id AS parentId,
            name,
            kind,
            type,
            origin,
            size,
            mtime_ms AS mtimeMs,
            source_ref AS sourceRef,
            provider_version AS providerVersion,
            deleted_at_ms AS deletedAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_nodes
          WHERE mount_node_id = ?`
        )
        .all(mountNodeId) as VfsNode[];
    },

    getNodeByMountNodeIdAndSourceRef(mountNodeId: string, sourceRef: string) {
      return db
        .query(
          `SELECT
            node_id AS nodeId,
            mount_id AS mountId,
            mount_node_id AS mountNodeId,
            parent_id AS parentId,
            name,
            kind,
            type,
            origin,
            size,
            mtime_ms AS mtimeMs,
            source_ref AS sourceRef,
            provider_version AS providerVersion,
            deleted_at_ms AS deletedAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_nodes
          WHERE mount_node_id = ?
            AND source_ref = ?
          LIMIT 1`
        )
        .get(mountNodeId, sourceRef) as VfsNode | null;
    },

    getNodeById(nodeId: string) {
      return db
        .query(
          `SELECT
            node_id AS nodeId,
            mount_id AS mountId,
            mount_node_id AS mountNodeId,
            parent_id AS parentId,
            name,
            kind,
            type,
            origin,
            size,
            mtime_ms AS mtimeMs,
            source_ref AS sourceRef,
            provider_version AS providerVersion,
            deleted_at_ms AS deletedAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_nodes
          WHERE node_id = ?
            AND deleted_at_ms IS NULL`
        )
        .get(nodeId) as VfsNode | null;
    },

    listChildrenPageLocal(input: ListChildrenPageLocalInput): ListChildrenPageLocalOutput {
      const { mountNodeId, parentId, limit, cursor } = input;
      const args = [] as Array<string | null>;
      let mountClause = "";
      if (mountNodeId) {
        mountClause = "AND mount_node_id = ?";
      }
      args.push(parentId);
      if (mountNodeId) {
        args.push(mountNodeId);
      }
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
            mount_node_id AS mountNodeId,
            parent_id AS parentId,
            name,
            kind,
            type,
            origin,
            size,
            mtime_ms AS mtimeMs,
            source_ref AS sourceRef,
            provider_version AS providerVersion,
            deleted_at_ms AS deletedAtMs,
            created_at_ms AS createdAtMs,
            updated_at_ms AS updatedAtMs
          FROM vfs_nodes
          WHERE parent_id IS ?
            AND deleted_at_ms IS NULL
            ${mountClause}
            ${cursorClause}
          ORDER BY name ASC, node_id ASC
          LIMIT ?`
        )
        .all(...args, limit + 1) as VfsNode[];

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, limit) : rows;
      if (!hasMore || items.length === 0) {
        return { items };
      }

      const last = items[items.length - 1]!;
      return {
        items,
        nextCursor: {
          lastName: last.name,
          lastNodeId: last.nodeId,
        },
      };
    },

    insertNodeEvents(rows: Array<Omit<VfsNodeEventRow, "id">>) {
      if (rows.length === 0) {
        return;
      }
      const insertedRows: VfsNodeEventRow[] = [];
      const insertStmt = db.query(
        `INSERT INTO vfs_node_events (
          id, source_ref, mount_id, parent_id, type, node_json, created_at_ms
        ) VALUES (
          ?,
          ?, ?, ?, ?, ?, ?
        )
        ON CONFLICT(source_ref, mount_id, type) DO UPDATE SET
          id=excluded.id,
          parent_id=excluded.parent_id,
          node_json=excluded.node_json,
          created_at_ms=excluded.created_at_ms`
      );
      const tx = db.transaction((items: Array<Omit<VfsNodeEventRow, "id">>) => {
        for (const row of items) {
          const id = randomUUID();
          insertStmt.run(
            id,
            row.sourceRef,
            row.mountId,
            row.parentId,
            row.type,
            row.node ? JSON.stringify(row.node) : null,
            row.createdAtMs
          );
          insertedRows.push({
            id,
            mountNodeId: row.mountNodeId ?? row.mountId,
            ...row,
          });
        }
      });
      tx(rows);
      notifyNodeEventsChanged(insertedRows.map((row) => row.mountId));
      function notifyNodeEventsChanged(mountIds: string[]): void {
        if (nodeEventsChangedListeners.size === 0) {
          return;
        }
        for (const mountId of new Set(mountIds)) {
          for (const listener of nodeEventsChangedListeners) {
            listener(mountId);
          }
        }
      }
    },

    listNodeEvents(input: ListNodeEventsInput = {}) {
      const limit = input.limit ?? 1000;
      const types = input.types?.length ? [...new Set(input.types)] : null;
      const typeClause = types ? `WHERE type IN (${types.map(() => "?").join(", ")})` : "";
      const rows = db
        .query(
          `SELECT
          id,
          source_ref AS sourceRef,
          mount_id AS mountId,
          parent_id AS parentId,
          type,
          node_json AS nodeJson,
          created_at_ms AS createdAtMs
        FROM vfs_node_events
        ${typeClause}
        ORDER BY created_at_ms ASC, mount_id ASC, source_ref ASC, type ASC
        LIMIT ?`
        )
        .all(...(types ?? []), limit) as Array<{
        id: string;
        sourceRef: string;
        mountId: string;
        parentId: string | null;
        type: "add" | "update_metadata" | "update_content" | "delete";
        nodeJson: string | null;
        createdAtMs: number;
      }>;
      return rows.map(mapNodeEventRow);
    },

    getQueueProgressByMountId(mountId: string) {
      const pendingUnitsRow = db
        .query(
          `SELECT COUNT(DISTINCT source_ref) AS pendingUnits
           FROM vfs_node_events
           WHERE mount_id = ?`
        )
        .get(mountId) as { pendingUnits: number } | null;

      return {
        pendingUnits: pendingUnitsRow?.pendingUnits ?? 0,
      };
    },

    deleteNodeEvents(rows: Array<Pick<VfsNodeEventRow, "id" | "mountId">>) {
      if (rows.length === 0) {
        return;
      }
      const stmt = db.query(`DELETE FROM vfs_node_events WHERE id = ?`);
      const tx = db.transaction((items: Array<Pick<VfsNodeEventRow, "id" | "mountId">>) => {
        for (const row of items) {
          stmt.run(row.id);
        }
      });
      tx(rows);
      if (nodeEventsChangedListeners.size === 0) {
        return;
      }
      for (const mountId of new Set(rows.map((row) => row.mountId))) {
        for (const listener of nodeEventsChangedListeners) {
          listener(mountId);
        }
      }
    },
  };
}

function normalizeNodeRow(row: VfsNode): VfsNode {
  const kind = row.kind;
  return {
    ...row,
    mountNodeId: row.mountNodeId ?? row.mountId,
    type: row.type ?? kind,
    origin: row.origin ?? (kind === "mount" ? "managed" : "provider"),
  };
}

function mapNodeEventRow(row: {
  id: string;
  sourceRef: string;
  mountId: string;
  parentId: string | null;
  type: VfsNodeEventRow["type"];
  nodeJson: string | null;
  createdAtMs: number;
}): VfsNodeEventRow {
  return {
    id: row.id,
    sourceRef: row.sourceRef,
    mountNodeId: row.mountId,
    mountId: row.mountId,
    parentId: row.parentId,
    type: row.type,
    node: parseNodeJson(row.nodeJson),
    createdAtMs: row.createdAtMs,
  };
}

function parseNodeJson(raw: string | null): VfsNode | null {
  if (!raw) {
    return null;
  }
  try {
    return JSON.parse(raw) as VfsNode;
  } catch {
    return null;
  }
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
