import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppContainer } from "./app.container";
import type { ConfigService } from "../core/config/config.types";

function makeConfigService(enabled: boolean): ConfigService {
  let mcpEnabled = enabled;
  let sources: Array<{ path: string; enabled: boolean }> = [];
  let embedding = {
    provider: "local" as const,
    local: {
      hfEndpoint: "https://hf-mirror.com",
      cacheDir: "build/cache/embedding/local",
      model: "Xenova/all-MiniLM-L6-v2",
      dimension: 384,
    },
    qwen_dense: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
    qwen_sparse: { apiKey: "", model: "text-embedding-v4", dimension: 1024 },
    openai_dense: { apiKey: "", model: "text-embedding-3-small", dimension: 1536 },
  };
  let reranker = {
    enabled: true,
    provider: "local" as const,
    local: {
      hfEndpoint: "https://hf-mirror.com",
      cacheDir: "build/cache/reranker/local",
      model: "BAAI/bge-reranker-base",
      topN: 5,
    },
    qwen: { apiKey: "", model: "gte-rerank-v2", topN: 5 },
    openai: { apiKey: "", model: "text-embedding-3-small", topN: 5 },
  };

  return {
    getConfig() {
      return {
        version: 1,
        sources,
        mcp: { enabled: mcpEnabled },
        ui: { mode: "safe" as const },
        indexing: { watch: { enabled: true } },
        embedding,
        reranker,
      };
    },
    getMcpEnabled() {
      return mcpEnabled;
    },
    setMcpEnabled(enabledNext: boolean) {
      mcpEnabled = enabledNext;
      return this.getConfig();
    },
    getSources() {
      return sources;
    },
    addSource(path: string) {
      if (!sources.some((item) => item.path === path)) {
        sources = [...sources, { path, enabled: true }];
      }
      return sources;
    },
    updateSource(path: string, enabledNext: boolean) {
      sources = sources.map((item) =>
        item.path === path ? { ...item, enabled: enabledNext } : item,
      );
      return sources;
    },
    removeSource(path: string) {
      sources = sources.filter((item) => item.path !== path);
      return sources;
    },
    updateEmbedding(input) {
      embedding = {
        ...embedding,
        ...input,
        local: { ...embedding.local, ...(input.local ?? {}) },
        qwen_dense: { ...embedding.qwen_dense, ...(input.qwen_dense ?? {}) },
        qwen_sparse: { ...embedding.qwen_sparse, ...(input.qwen_sparse ?? {}) },
        openai_dense: { ...embedding.openai_dense, ...(input.openai_dense ?? {}) },
      };
      return this.getConfig();
    },
    updateReranker(input) {
      reranker = {
        ...reranker,
        ...input,
        local: { ...reranker.local, ...(input.local ?? {}) },
        qwen: { ...reranker.qwen, ...(input.qwen ?? {}) },
        openai: { ...reranker.openai, ...(input.openai ?? {}) },
      };
      return this.getConfig();
    },
  };
}

test("does not create mcp server when mcp is disabled", () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-app-container-"));
  const container = createAppContainer({
    configService: makeConfigService(false),
    vectorCollectionPath: join(dir, "v.zvec"),
  });
  expect(container.mcpServer).toBeNull();
  rmSync(dir, { recursive: true, force: true });
});

test("mcp server delegates search to retrieval service", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-app-container-"));
  const container = createAppContainer({
    configService: makeConfigService(true),
    vectorCollectionPath: join(dir, "v.zvec"),
  });
  expect(container.mcpServer).not.toBeNull();

  let called = false;
  container.retrievalService.search = async () => {
    called = true;
    return [{ sourcePath: "docs/a.md", chunkText: "a" }];
  };

  const result = await container.mcpServer!.callTool("search_local_knowledge", {
    query: "a",
    top_k: 1,
  });

  expect(called).toBe(true);
  expect(Array.isArray(result.results)).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test("addSourceAndReindex triggers indexing task", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-app-container-"));
  const container = createAppContainer({
    configService: makeConfigService(true),
    vectorCollectionPath: join(dir, "v.zvec"),
  });
  const calls: string[] = [];
  const original = container.indexingService.runFullRebuild;
  container.indexingService.runFullRebuild = async (reason: string) => {
    calls.push(reason);
    return original(reason);
  };

  await container.addSourceAndReindex("/tmp/docs");

  expect(calls).toEqual(["source_added"]);
  rmSync(dir, { recursive: true, force: true });
});
