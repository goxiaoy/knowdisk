import { expect, test } from "bun:test";
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
        embedding: { mode: "local" as const, model: "bge-small", endpoint: "" },
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
  };
}

test("does not create mcp server when mcp is disabled", () => {
  const container = createAppContainer({ configService: makeConfigService(false) });
  expect(container.mcpServer).toBeNull();
});

test("mcp server delegates search to retrieval service", async () => {
  const container = createAppContainer({ configService: makeConfigService(true) });
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
});
