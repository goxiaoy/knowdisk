import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VfsMount } from "../../vfs.types";
import { createLocalVfsProvider } from "./index";

function createMockLogger() {
  const records: Array<{ level: "info" | "warn" | "error" | "debug"; msg: string }> = [];
  return {
    logger: {
      info: (_obj: unknown, msg?: string) => records.push({ level: "info", msg: msg ?? "" }),
      warn: (_obj: unknown, msg?: string) => records.push({ level: "warn", msg: msg ?? "" }),
      error: (_obj: unknown, msg?: string) => records.push({ level: "error", msg: msg ?? "" }),
      debug: (_obj: unknown, msg?: string) => records.push({ level: "debug", msg: msg ?? "" }),
    },
    records,
  };
}

function makeMount(directory: string): VfsMount {
  return {
    mountId: "local-1",
    providerType: "local",
    providerExtra: { directory },
    syncMetadata: true,
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
  };
}

function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text();
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (predicate()) {
      return true;
    }
    await Bun.sleep(50);
  }
  return predicate();
}

describe("local vfs provider", () => {
  test("listChildren/read/getMetadata from local directory", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-local-"));
    try {
      writeFileSync(join(dir, "a.txt"), "alpha");
      await mkdir(join(dir, "sub"), { recursive: true });
      writeFileSync(join(dir, "sub", "b.txt"), "beta");

      const mount = makeMount(dir);
      const provider = createLocalVfsProvider(mount);

      const root = await provider.listChildren({
        parentId: null,
        limit: 10,
      });
      expect(root.items.map((item) => `${item.kind}:${item.name}`)).toEqual([
        "file:a.txt",
        "folder:sub",
      ]);

      const content = await readAll(
        await provider.createReadStream!({
          id: "a.txt",
        }),
      );
      expect(content).toBe("alpha");

      const metadata = await provider.getMetadata!({
        id: "sub/b.txt",
      });
      expect(metadata?.kind).toBe("file");
      expect(metadata?.name).toBe("b.txt");
      expect(metadata?.parentId).toBe("sub");
      expect((metadata?.size ?? 0) > 0).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("watch emits add/update_content/delete events via chokidar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-local-watch-"));
    try {
      const mount = makeMount(dir);
      const provider = createLocalVfsProvider(mount);
      const events: Array<{ type: "add" | "update_content" | "delete"; id: string }> = [];
      const watcher = await provider.watch!({
        onEvent(event) {
          events.push({ type: event.type, id: event.id });
        },
      });

      writeFileSync(join(dir, "watch.txt"), "x");
      const sawAdd = await waitUntil(
        () =>
          events.some(
            (event) => event.type === "add" && event.id === "watch.txt",
          ),
        4000,
      );
      await Bun.sleep(100);
      writeFileSync(join(dir, "watch.txt"), "y");
      const sawUpdate = await waitUntil(
        () =>
          events.some(
            (event) => event.type === "update_content" && event.id === "watch.txt",
          ),
        4000,
      );
      rmSync(join(dir, "watch.txt"), { force: true });
      const sawDelete = await waitUntil(
        () =>
          events.some(
            (event) => event.type === "delete" && event.id === "watch.txt",
          ),
        4000,
      );
      await watcher.close();

      expect(sawAdd).toBe(true);
      expect(sawUpdate).toBe(true);
      expect(sawDelete).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 15000);

  test("writes provider operation logs", async () => {
    const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-local-logs-"));
    try {
      writeFileSync(join(dir, "a.txt"), "alpha");
      const mount = makeMount(dir);
      const mock = createMockLogger();
      const provider = createLocalVfsProvider(mount, {
        logger: mock.logger as never,
      });

      await provider.listChildren({
        parentId: null,
        limit: 10,
      });

      expect(
        mock.records.some(
          (record) => record.level === "info" && record.msg.includes("local listChildren"),
        ),
      ).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
