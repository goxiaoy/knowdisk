import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { createVfsRepository } from "./vfs.repository";
import { listAppliedVfsDbMigrationIds, rollbackVfsDbMigration } from "./migrations";

function makeTempDbPath(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-migrations-"));
  return { dir, dbPath: join(dir, "vfs.db") };
}

describe("vfs db migrations", () => {
  test("repository startup creates migration table and records applied migrations", () => {
    const { dir, dbPath } = makeTempDbPath();
    const repo = createVfsRepository({ dbPath });
    repo.close();

    const db = new Database(dbPath, { readonly: true });
    const appliedIds = listAppliedVfsDbMigrationIds(db);

    expect(appliedIds).toEqual(["001_initial"]);

    const nodeColumns = db.query("PRAGMA table_info(vfs_nodes)").all() as Array<{ name: string }>;
    expect(nodeColumns.map((column) => column.name)).toEqual(
      expect.arrayContaining(["mount_node_id", "type", "origin"])
    );

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });

  test("down script drops VFS tables and clears applied migration record", () => {
    const { dir, dbPath } = makeTempDbPath();
    const repo = createVfsRepository({ dbPath });
    repo.close();

    const db = new Database(dbPath, { create: true });

    expect(listAppliedVfsDbMigrationIds(db)).toEqual(["001_initial"]);
    expect(rollbackVfsDbMigration(db, "001_initial")).toBe(true);

    const tables = db
      .query("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as Array<{ name: string }>;
    expect(tables.map((table) => table.name)).toEqual(["vfs_migrations"]);
    expect(listAppliedVfsDbMigrationIds(db)).toEqual([]);

    db.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
