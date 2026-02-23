import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
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
        onboarding: { completed: true },
        sources,
        mcp: { enabled: mcpEnabled, port: 3467 },
        ui: { mode: "safe" as const },
        indexing: {
          watch: { enabled: true, debounceMs: 500 },
          reconcile: { enabled: true, intervalMs: 15 * 60 * 1000 },
          worker: { concurrency: 2, batchSize: 64 },
          retry: { maxAttempts: 3, backoffMs: [1000, 5000, 20000] },
        },
        retrieval: {
          hybrid: { ftsTopN: 30, vectorTopK: 20, rerankTopN: 10 },
        },
        embedding,
        reranker,
      };
    },
    updateConfig(updater) {
      const next = updater(this.getConfig());
      mcpEnabled = next.mcp.enabled;
      sources = next.sources;
      embedding = next.embedding;
      reranker = next.reranker;
      return next;
    },
    subscribe() {
      return () => {};
    },
  };
}

test("mcp server rejects calls when mcp is disabled", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-app-container-"));
  const container = createAppContainer({
    configService: makeConfigService(false),
    vectorCollectionPath: join(dir, "v.zvec"),
  });
  expect(container.mcpServer).not.toBeNull();
  await expect(
    container.mcpServer!.callTool("search_local_knowledge", { query: "x" }),
  ).rejects.toThrow("MCP_DISABLED");
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

test("uses userDataDir as base path for vector collection", () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "knowdisk-app-container-userdata-"));
  createAppContainer({
    configService: makeConfigService(true),
    userDataDir,
  });

  const expectedVectorDir = join(userDataDir, "zvec", "provider-local", "dim-384");
  expect(existsSync(expectedVectorDir)).toBe(true);

  rmSync(userDataDir, { recursive: true, force: true });
});
