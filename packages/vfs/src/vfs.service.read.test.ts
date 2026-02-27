import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import { createVfsRepository } from "./vfs.repository";
import { createVfsService } from "./vfs.service";

describe("vfs service boundary", () => {
  test("does not expose markdown read API", () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-boundary-"));
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
    const service = createVfsService({ repository: repo, registry, nowMs: () => 1_000 });

    expect("readMarkdown" in (service as object)).toBe(false);

    repo.close();
    rmSync(dir, { recursive: true, force: true });
  });
});
