import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import pino from "pino";
import { createLocalVfsProvider } from "./provider/local";
import {
  createVfsContentNodeEventsProcessor,
  createVfsMetadataNodeEventsProcessor,
} from "./vfs.node-event-processor";
import { walk } from "./vfs.provider.walk";
import { createVfsRepository } from "./vfs.repository";
import { createVfsSyncer } from "./vfs.syncer";
import type { VfsMount } from "./vfs.types";

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await Bun.sleep(30);
  }
  return predicate();
}

async function walkLocalFs(
  root: string
): Promise<Map<string, { kind: "file" | "folder"; size: number | null }>> {
  const out = new Map<string, { kind: "file" | "folder"; size: number | null }>();
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith(".")) {
        continue;
      }
      const abs = join(dir, entry.name);
      const rel = relative(root, abs).split("\\").join("/");
      const st = await stat(abs);
      if (entry.isDirectory()) {
        out.set(rel, { kind: "folder", size: null });
        queue.push(abs);
      } else {
        out.set(rel, { kind: "file", size: st.size });
      }
    }
  }
  return out;
}

describe("vfs syncer integration", () => {
  test("local provider fullSync and watch stay aligned with filesystem changes", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-local-int-"));
    const sourceRoot = join(dir, "source");
    await mkdir(join(sourceRoot, "docs"), { recursive: true });
    writeFileSync(join(sourceRoot, "a.txt"), "alpha");
    writeFileSync(join(sourceRoot, "docs", "b.txt"), "beta");
    const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
    try {
      const mount: VfsMount = {
        mountId: "local-int",
        providerType: "local",
        providerExtra: { directory: sourceRoot },
        syncMetadata: true,
        syncContent: true,
        metadataTtlSec: 60,
        reconcileIntervalMs: 1000,
      };
      const provider = createLocalVfsProvider(mount);
      const logger = pino({ name: "vfs.syncer.integration.local", level: "info" });
      const syncer = createVfsSyncer({
        mount,
        provider,
        repository: repo,
        contentRootParent: join(dir, "content"),
        logger,
      });
      const metadataProcessor = createVfsMetadataNodeEventsProcessor({
        repository: repo,
        contentRootParent: join(dir, "content"),
        resolveMount(mountId) {
          return mountId === mount.mountId ? mount : null;
        },
        resolveProvider() {
          return provider;
        },
        logger,
      });
      const contentProcessor = createVfsContentNodeEventsProcessor({
        repository: repo,
        contentRootParent: join(dir, "content"),
        resolveMount(mountId) {
          return mountId === mount.mountId ? mount : null;
        },
        resolveProvider() {
          return provider;
        },
        logger,
      });
      syncer.subscribe((event) => {
        if (event.type === "status") {
          logger.info({ event: event.payload }, "syncer status event");
        }
      });

      await syncer.fullSync();
      await metadataProcessor.drain();
      await contentProcessor.drain({ allowContentSync: false });

      const fsMap1 = await walkLocalFs(sourceRoot);
      const dbMap1 = new Map(
        repo
          .listNodesByMountId(mount.mountId)
          .filter((node) => node.deletedAtMs === null)
          .map((node) => [node.sourceRef, node])
      );
      expect(dbMap1.size).toBe(fsMap1.size);
      for (const [sourceRef, f] of fsMap1.entries()) {
        const node = dbMap1.get(sourceRef);
        expect(node).toBeDefined();
        expect(node!.kind).toBe(f.kind);
        if (f.kind === "file") {
          expect(node!.size).toBe(f.size);
        }
      }

      metadataProcessor.start();
      contentProcessor.start();
      await syncer.startWatching();
      await mkdir(join(sourceRoot, "newdir"), { recursive: true });
      writeFileSync(join(sourceRoot, "newdir", "c.txt"), "ccc");
      writeFileSync(join(sourceRoot, "a.txt"), "alpha-updated");
      rmSync(join(sourceRoot, "docs", "b.txt"), { force: true });

      const settled = await waitUntil(() => {
        const c = repo.listNodesByMountIdAndSourceRef(mount.mountId, "newdir/c.txt");
        const a = repo.listNodesByMountIdAndSourceRef(mount.mountId, "a.txt");
        const b = repo.listNodesByMountIdAndSourceRef(mount.mountId, "docs/b.txt");
        return (
          c?.deletedAtMs === null &&
          a?.deletedAtMs === null &&
          (a?.size ?? 0) > 5 &&
          (b?.deletedAtMs ?? null) !== null
        );
      }, 3000);
      expect(settled).toBe(true);
      await syncer.stopWatching();
      metadataProcessor.close();
      contentProcessor.close();

      const fsMap2 = await walkLocalFs(sourceRoot);
      const dbMap2 = new Map(
        repo
          .listNodesByMountId(mount.mountId)
          .filter((node) => node.deletedAtMs === null)
          .map((node) => [node.sourceRef, node])
      );
      expect(dbMap2.size).toBe(fsMap2.size);
      for (const [sourceRef, f] of fsMap2.entries()) {
        const node = dbMap2.get(sourceRef);
        expect(node).toBeDefined();
        expect(node!.kind).toBe(f.kind);
        if (f.kind === "file") {
          expect(node!.size).toBe(f.size);
        }
      }

      const localContentPath = join(dir, "content", mount.mountId, "newdir", "c.txt");
      expect(readFileSync(localContentPath, "utf8")).toBe("ccc");
    } finally {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
