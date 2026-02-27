import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import { createVfsRepository } from "./vfs.repository";
import { createVfsService } from "./vfs.service";
import type { VfsProviderAdapter } from "./vfs.provider.types";

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-vfs-read-"));
  const repo = createVfsRepository({ dbPath: join(dir, "vfs.db") });
  const registry = createVfsProviderRegistry();
  const service = createVfsService({ repository: repo, registry, nowMs: () => 1_000 });
  return {
    dir,
    repo,
    registry,
    service,
    cleanup() {
      repo.close();
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

async function mountWithNode(ctx: ReturnType<typeof setup>, opts?: {
  mountId?: string;
  mountPath?: string;
  providerType?: string;
  providerVersion?: string | null;
  contentState?: "missing" | "cached" | "stale";
}) {
  const mountId = opts?.mountId ?? "m1";
  const mountPath = opts?.mountPath ?? "/abc/drive";
  const providerType = opts?.providerType ?? "mock-read";
  await ctx.service.mount({
    mountId,
    mountPath,
    providerType,
    syncMetadata: true,
    syncContent: "lazy",
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
  });
  ctx.repo.upsertNodes([
    {
      nodeId: "n1",
      mountId,
      parentId: null,
      name: "doc.md",
      vpath: `${mountPath}/doc.md`,
      kind: "file",
      title: "Doc",
      size: 1,
      mtimeMs: 1,
      sourceRef: "s1",
      providerVersion: opts?.providerVersion ?? "v1",
      contentHash: null,
      contentState: opts?.contentState ?? "missing",
      deletedAtMs: null,
      createdAtMs: 1,
      updatedAtMs: 1,
    },
  ]);
  return `${mountPath}/doc.md`;
}

describe("vfs service readMarkdown", () => {
  test("cache hit returns markdown immediately", async () => {
    const ctx = setup();
    const path = await mountWithNode(ctx, { contentState: "cached" });
    let called = 0;
    ctx.registry.register({
      type: "mock-read",
      capabilities: { watch: false, exportMarkdown: true, downloadRaw: true },
      async listChildren() {
        return { items: [] };
      },
      async exportMarkdown() {
        called += 1;
        return { markdown: "# updated" };
      },
      async downloadRaw() {
        called += 1;
        return { localPath: "/tmp/unused" };
      },
    });
    ctx.repo.upsertMarkdownCache({
      nodeId: "n1",
      markdownFull: "# cached",
      markdownHash: "sha256:cached",
      generatedBy: "provider_export",
      updatedAtMs: 1,
    });

    const result = await ctx.service.readMarkdown(path);
    expect(result.markdown).toBe("# cached");
    expect(called).toBe(0);

    ctx.cleanup();
  });

  test("stale by provider version triggers refresh", async () => {
    const ctx = setup();
    const path = await mountWithNode(ctx, { contentState: "stale", providerVersion: "v1" });
    ctx.registry.register({
      type: "mock-read",
      capabilities: { watch: false, exportMarkdown: true, downloadRaw: false },
      async listChildren() {
        return { items: [] };
      },
      async exportMarkdown() {
        return { markdown: "# refreshed", providerVersion: "v2" };
      },
    });
    ctx.repo.upsertMarkdownCache({
      nodeId: "n1",
      markdownFull: "# old",
      markdownHash: "sha256:old",
      generatedBy: "provider_export",
      updatedAtMs: 1,
    });

    const result = await ctx.service.readMarkdown(path);
    expect(result.markdown).toBe("# refreshed");
    expect(result.node.providerVersion).toBe("v2");

    ctx.cleanup();
  });

  test("refresh path chooses exportMarkdown when supported", async () => {
    const ctx = setup();
    const path = await mountWithNode(ctx, { contentState: "missing" });
    let exportCalled = 0;
    let downloadCalled = 0;
    const rawPath = join(ctx.dir, "raw.txt");
    writeFileSync(rawPath, "raw body", "utf8");

    const adapter: VfsProviderAdapter = {
      type: "mock-read",
      capabilities: { watch: false, exportMarkdown: true, downloadRaw: true },
      async listChildren() {
        return { items: [] };
      },
      async exportMarkdown() {
        exportCalled += 1;
        return { markdown: "# from export", providerVersion: "v2" };
      },
      async downloadRaw() {
        downloadCalled += 1;
        return { localPath: rawPath, providerVersion: "v2" };
      },
    };
    ctx.registry.register(adapter);

    const result = await ctx.service.readMarkdown(path);
    expect(result.markdown).toBe("# from export");
    expect(exportCalled).toBe(1);
    expect(downloadCalled).toBe(0);

    ctx.cleanup();
  });

  test("fallback path uses downloadRaw + parser -> markdown", async () => {
    const ctx = setup();
    const path = await mountWithNode(ctx, { contentState: "missing" });
    const rawPath = join(ctx.dir, "raw.txt");
    writeFileSync(rawPath, "hello from txt", "utf8");

    ctx.registry.register({
      type: "mock-read",
      capabilities: { watch: false, exportMarkdown: false, downloadRaw: true },
      async listChildren() {
        return { items: [] };
      },
      async downloadRaw() {
        return { localPath: rawPath, providerVersion: "v3" };
      },
    });

    const result = await ctx.service.readMarkdown(path);
    expect(result.markdown).toContain("hello from txt");
    expect(result.node.providerVersion).toBe("v3");

    ctx.cleanup();
  });

  test("after refresh, writes markdown cache + chunks + content hash", async () => {
    const ctx = setup();
    const path = await mountWithNode(ctx, { contentState: "missing" });
    ctx.registry.register({
      type: "mock-read",
      capabilities: { watch: false, exportMarkdown: true, downloadRaw: false },
      async listChildren() {
        return { items: [] };
      },
      async exportMarkdown() {
        return { markdown: "# refreshed content", providerVersion: "v9" };
      },
    });

    await ctx.service.readMarkdown(path);

    const cache = ctx.repo.getMarkdownCache("n1");
    expect(cache?.markdownFull).toBe("# refreshed content");

    const chunks = ctx.repo.listChunksByNodeId("n1");
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.map((chunk) => chunk.seq)).toEqual([0]);

    const node = ctx.repo.getNodeByVpath(path);
    expect(node?.contentState).toBe("cached");
    expect(node?.contentHash?.startsWith("sha256:")).toBe(true);

    ctx.cleanup();
  });
});
