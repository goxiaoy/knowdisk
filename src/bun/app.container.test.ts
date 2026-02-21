import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppContainer } from "./app.container";
import type { ConfigService } from "../core/config/config.types";

function makeConfigService(enabled: boolean): ConfigService {
  let mcpEnabled = enabled;
  let sources: Array<{ path: string; enabled: boolean }> = [];
  return {
    getConfig() {
      return {
        version: 1,
        sources,
        mcp: { enabled: mcpEnabled },
        ui: { mode: "safe" as const },
        indexing: { watch: { enabled: true } },
        embedding: {
          mode: "local" as const,
          model: "BAAI/bge-small-en-v1.5",
          endpoint: "",
          dimension: 384,
        },
        reranker: { mode: "local" as const, model: "BAAI/bge-reranker-base", topN: 5 },
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
      const current = this.getConfig();
      return { ...current, embedding: { ...current.embedding, ...input } };
    },
    updateReranker(input) {
      const current = this.getConfig();
      return { ...current, reranker: { ...current.reranker, ...input } };
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
