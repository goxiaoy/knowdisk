import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { mkdir, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import pino from "pino";
import { createHuggingFaceVfsProvider } from "./provider/huggingface";
import { createLocalVfsProvider } from "./provider/local";
import { createVfsRepository } from "./vfs.repository";
import { createVfsSyncer } from "./vfs.syncer";
import type { ListChildrenItem } from "./vfs.service.types";
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

async function walkProviderTree(input: {
  listChildren: (params: {
    mount: VfsMount;
    parentSourceRef: string | null;
    limit: number;
    cursor?: string;
  }) => Promise<{ items: ListChildrenItem[]; nextCursor?: string }>;
  getMetadata?: (params: { mount: VfsMount; sourceRef: string }) => Promise<ListChildrenItem | null>;
  mount: VfsMount;
}): Promise<Map<string, ListChildrenItem>> {
  const out = new Map<string, ListChildrenItem>();
  const queue: Array<string | null> = [null];
  while (queue.length > 0) {
    const parentSourceRef = queue.shift() ?? null;
    let cursor: string | undefined;
    do {
      const page = await input.listChildren({
        mount: input.mount,
        parentSourceRef,
        limit: 200,
        cursor,
      });
      for (const item of page.items) {
        let normalized = item;
        if (item.kind === "file" && (item.size ?? 0) <= 0 && input.getMetadata) {
          const m = await input.getMetadata({
            mount: input.mount,
            sourceRef: item.sourceRef,
          });
          if (m) {
            normalized = { ...item, size: m.size ?? item.size };
          }
        }
        out.set(item.sourceRef, normalized);
        if (item.kind === "folder") {
          queue.push(item.sourceRef);
        }
      }
      cursor = page.nextCursor;
    } while (cursor);
  }
  return out;
}

async function walkLocalFs(root: string): Promise<Map<string, { kind: "file" | "folder"; size: number | null }>> {
  const out = new Map<string, { kind: "file" | "folder"; size: number | null }>();
  const queue: string[] = [root];
  while (queue.length > 0) {
    const dir = queue.shift()!;
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
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
  test(
    "huggingface provider fullSync keeps db metadata aligned with remote listing",
    async () => {
      const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-syncer-hf-int-"));
      const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
      try {
        const mount: VfsMount = {
          mountId: "hf-int",
          mountPath: "/hf",
          providerType: "huggingface",
          providerExtra: { model: "hf-internal-testing/tiny-random-bert" },
          syncMetadata: true,
          syncContent: false,
          metadataTtlSec: 60,
          reconcileIntervalMs: 1000,
        };
        const provider = createHuggingFaceVfsProvider(mount);
        const logger = pino({ name: "vfs.syncer.integration.hf", level: "info" });
        const syncer = createVfsSyncer({
          mount,
          provider,
          repository: repo,
          contentRootParent: join(dir, "content"),
          logger,
        });
        syncer.subscribe((event) => {
          if (event.type === "status") {
            logger.info({ event: event.payload }, "syncer status event");
          }
        });

        await syncer.fullSync();

        const remote = await walkProviderTree({
          listChildren: provider.listChildren,
          getMetadata: provider.getMetadata,
          mount,
        });
        const dbNodes = repo
          .listNodesByMountId(mount.mountId)
          .filter((node) => node.deletedAtMs === null);
        expect(dbNodes.length).toBe(remote.size);

        for (const node of dbNodes) {
          const r = remote.get(node.sourceRef);
          expect(r).toBeDefined();
          expect(node.kind).toBe(r!.kind);
          expect(node.name).toBe(r!.name);
          if (r!.kind === "file") {
            expect(node.size).toBe(r!.size ?? null);
          }
        }
      } finally {
        repo.close();
        rmSync(dir, { recursive: true, force: true });
      }
    },
    5 * 60 * 1000,
  );

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
        mountPath: "/local",
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
      syncer.subscribe((event) => {
        if (event.type === "status") {
          logger.info({ event: event.payload }, "syncer status event");
        }
      });

      await syncer.fullSync();

      const fsMap1 = await walkLocalFs(sourceRoot);
      const dbMap1 = new Map(
        repo
          .listNodesByMountId(mount.mountId)
          .filter((node) => node.deletedAtMs === null)
          .map((node) => [node.sourceRef, node]),
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

      await syncer.startWatching();
      await mkdir(join(sourceRoot, "newdir"), { recursive: true });
      writeFileSync(join(sourceRoot, "newdir", "c.txt"), "ccc");
      writeFileSync(join(sourceRoot, "a.txt"), "alpha-updated");
      rmSync(join(sourceRoot, "docs", "b.txt"), { force: true });

      const settled = await waitUntil(() => {
        const nodes = repo.listNodesByMountId(mount.mountId);
        const c = nodes.find((n) => n.sourceRef === "newdir/c.txt");
        const a = nodes.find((n) => n.sourceRef === "a.txt");
        const b = nodes.find((n) => n.sourceRef === "docs/b.txt");
        return (
          c?.deletedAtMs === null &&
          a?.deletedAtMs === null &&
          (a?.size ?? 0) > 5 &&
          (b?.deletedAtMs ?? null) !== null
        );
      }, 3000);
      expect(settled).toBe(true);
      await syncer.stopWatching();

      const fsMap2 = await walkLocalFs(sourceRoot);
      const dbMap2 = new Map(
        repo
          .listNodesByMountId(mount.mountId)
          .filter((node) => node.deletedAtMs === null)
          .map((node) => [node.sourceRef, node]),
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
