import type { VfsDbMigration } from "./types";

export const vfsDbMigration001Initial: VfsDbMigration = {
  id: "001_initial",
  upSql: `
    CREATE TABLE IF NOT EXISTS vfs_nodes (
      -- Stable unique node identifier used across the VFS domain.
      node_id TEXT PRIMARY KEY,
      -- Owning mount identifier for this node.
      mount_id TEXT NOT NULL,
      -- Root mount node identifier used to scope local traversal within one mount tree.
      mount_node_id TEXT NOT NULL DEFAULT '',
      -- Parent node identifier; NULL means this node is at the root level.
      parent_id TEXT,
      -- Display name shown to users.
      name TEXT NOT NULL,
      -- Structural classification such as mount, folder, or file.
      kind TEXT NOT NULL,
      -- Semantic node type used by higher-level APIs.
      type TEXT NOT NULL DEFAULT 'file',
      -- Source of truth for the node, for example managed or provider.
      origin TEXT NOT NULL DEFAULT 'provider',
      -- Optional file size in bytes.
      size INTEGER,
      -- Optional last modified timestamp in milliseconds.
      mtime_ms INTEGER,
      -- Provider-specific stable reference for sync and deduplication.
      source_ref TEXT NOT NULL,
      -- Provider revision/version marker for change detection.
      provider_version TEXT,
      -- Soft-delete timestamp in milliseconds; NULL means active.
      deleted_at_ms INTEGER,
      -- Creation timestamp in milliseconds.
      created_at_ms INTEGER NOT NULL,
      -- Last update timestamp in milliseconds.
      updated_at_ms INTEGER NOT NULL,
      UNIQUE(mount_id, source_ref)
    );
    CREATE INDEX IF NOT EXISTS idx_vfs_nodes_parent_order
      ON vfs_nodes (parent_id, name, node_id);
    CREATE INDEX IF NOT EXISTS idx_vfs_nodes_mount_parent_order
      ON vfs_nodes (mount_id, parent_id, name, node_id);

    CREATE TABLE IF NOT EXISTS vfs_node_mount_ext (
      -- Mount root node identifier; references vfs_nodes.node_id.
      node_id TEXT PRIMARY KEY,
      -- Public mount identifier.
      mount_id TEXT UNIQUE NOT NULL,
      -- Registered provider type name.
      provider_type TEXT NOT NULL,
      -- Provider-specific serialized configuration payload.
      provider_extra TEXT NOT NULL,
      -- Whether background auto sync is enabled for this mount.
      auto_sync INTEGER NOT NULL DEFAULT 1,
      -- Whether content bytes should be mirrored locally in addition to metadata.
      sync_content INTEGER NOT NULL DEFAULT 0,
      -- Metadata cache TTL in seconds.
      metadata_ttl_sec INTEGER NOT NULL,
      -- Reconcile scheduling interval in milliseconds.
      reconcile_interval_ms INTEGER NOT NULL,
      -- Creation timestamp in milliseconds.
      created_at_ms INTEGER NOT NULL,
      -- Last update timestamp in milliseconds.
      updated_at_ms INTEGER NOT NULL,
      FOREIGN KEY(node_id) REFERENCES vfs_nodes(node_id)
    );

    CREATE TABLE IF NOT EXISTS vfs_node_events (
      -- Unique event identifier.
      id TEXT PRIMARY KEY,
      -- Target mount identifier for the queued event.
      mount_id TEXT NOT NULL,
      -- Provider-side stable reference for the affected node.
      source_ref TEXT NOT NULL,
      -- Parent node identifier associated with the event payload.
      parent_id TEXT,
      -- Event kind such as add, update_metadata, update_content, or delete.
      type TEXT NOT NULL,
      -- Serialized node snapshot payload; NULL for delete-only events.
      node_json TEXT,
      -- Event creation timestamp in milliseconds.
      created_at_ms INTEGER NOT NULL,
      UNIQUE (source_ref, mount_id, type)
    );
    CREATE INDEX IF NOT EXISTS idx_vfs_node_events_updated
      ON vfs_node_events (id);
  `,
  downSql: `
    DROP TABLE IF EXISTS vfs_node_events;
    DROP TABLE IF EXISTS vfs_node_mount_ext;
    DROP TABLE IF EXISTS vfs_nodes;
  `,
};
