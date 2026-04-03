import type { Database } from "bun:sqlite";
import { vfsDbMigration001Initial } from "./001_initial";
import type { VfsDbMigration } from "./types";

const VFS_MIGRATION_TABLE = "vfs_migrations";

export const vfsDbMigrations: VfsDbMigration[] = [vfsDbMigration001Initial];

export function runVfsDbMigrations(
  db: Database,
  opts: {
    nowMs?: () => number;
  } = {}
): void {
  ensureMigrationTable(db);
  const applied = new Set(listAppliedVfsDbMigrationIds(db));
  const nowMs = opts.nowMs ?? Date.now;
  const recordMigration = db.query(
    `INSERT INTO ${VFS_MIGRATION_TABLE} (id, applied_at_ms) VALUES (?, ?)`
  );

  for (const migration of vfsDbMigrations) {
    if (applied.has(migration.id)) {
      continue;
    }
    const apply = db.transaction(() => {
      db.exec(migration.upSql);
      recordMigration.run(migration.id, nowMs());
    });
    apply();
    applied.add(migration.id);
  }
}

export function rollbackVfsDbMigration(db: Database, migrationId: string): boolean {
  ensureMigrationTable(db);
  const migration = vfsDbMigrations.find((item) => item.id === migrationId);
  if (!migration) {
    throw new Error(`Unknown VFS DB migration: ${migrationId}`);
  }
  const appliedIds = listAppliedVfsDbMigrationIds(db);
  const applied = new Set(appliedIds);
  if (!applied.has(migrationId)) {
    return false;
  }
  const lastAppliedId = appliedIds[appliedIds.length - 1];
  if (lastAppliedId !== migrationId) {
    throw new Error(
      `VFS DB migration rollback must start from the latest migration: ${lastAppliedId}`
    );
  }

  const removeMigration = db.query(`DELETE FROM ${VFS_MIGRATION_TABLE} WHERE id = ?`);
  const rollback = db.transaction(() => {
    db.exec(migration.downSql);
    removeMigration.run(migrationId);
  });
  rollback();
  return true;
}

export function listAppliedVfsDbMigrationIds(db: Database): string[] {
  if (!hasMigrationTable(db)) {
    return [];
  }
  return (
    db.query(`SELECT id FROM ${VFS_MIGRATION_TABLE} ORDER BY id ASC`).all() as Array<{
      id: string;
    }>
  ).map((row) => row.id);
}

function ensureMigrationTable(db: Database): void {
  if (hasMigrationTable(db)) {
    return;
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${VFS_MIGRATION_TABLE} (
      id TEXT PRIMARY KEY,
      applied_at_ms INTEGER NOT NULL
    );
  `);
}

function hasMigrationTable(db: Database): boolean {
  const row = db
    .query(
      `SELECT name
       FROM sqlite_master
       WHERE type = 'table' AND name = ?`
    )
    .get(VFS_MIGRATION_TABLE) as { name: string } | null;
  return row?.name === VFS_MIGRATION_TABLE;
}
