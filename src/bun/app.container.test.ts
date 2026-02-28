import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAppContainer } from "./app.container";
import type { AppConfig, ConfigService } from "../core/config/config.types";
import { createDefaultConfig } from "../core/config/default-config";

function makeConfigService(enabled: boolean): ConfigService {
  let config: AppConfig = {
    ...createDefaultConfig(),
    onboarding: { completed: true },
    mcp: { enabled, port: 3467 },
    embedding: {
      ...createDefaultConfig().embedding,
      provider: "local",
      local: {
        ...createDefaultConfig().embedding.local,
        dimension: 384,
      },
    },
  };

  return {
    getConfig() {
      return config;
    },
    updateConfig(updater) {
      config = updater(config);
      return config;
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
    return {
      reranked: [{ chunkId: "c1", sourcePath: "docs/a.md", chunkText: "a", score: 1 }],
      fts: [],
      vector: [{ chunkId: "c1", sourcePath: "docs/a.md", chunkText: "a", score: 1 }],
    };
  };

  const result = await container.mcpServer!.callTool("search_local_knowledge", {
    query: "a",
    top_k: 1,
  });

  expect(called).toBe(true);
  expect(Array.isArray((result as { reranked: unknown[] }).reranked)).toBe(true);
  rmSync(dir, { recursive: true, force: true });
});

test("uses userDataDir as base path for vector collection", () => {
  const userDataDir = mkdtempSync(join(tmpdir(), "knowdisk-app-container-userdata-"));
  const container = createAppContainer({
    configService: makeConfigService(true),
    userDataDir,
  });
  container.chatService.createSession({ title: "chat-db-check" });

  const expectedVectorDir = join(userDataDir, "zvec", "provider-local", "dim-384");
  const expectedChatDb = join(userDataDir, "chat", "chat.db");
  expect(existsSync(expectedVectorDir)).toBe(true);
  expect(existsSync(expectedChatDb)).toBe(true);

  rmSync(userDataDir, { recursive: true, force: true });
});

test("registers huggingface vfs provider in app container", async () => {
  const dir = mkdtempSync(join(tmpdir(), "knowdisk-app-container-vfs-"));
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    if (String(input).includes("/api/models/")) {
      return new Response(
        JSON.stringify({
          siblings: [{ rfilename: "onnx/model.onnx", size: 123 }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }
    return new Response("ok", { status: 200 });
  }) as typeof fetch;
  try {
    const container = createAppContainer({
      configService: makeConfigService(false),
      userDataDir: dir,
    });
    const mount = await container.vfsService.mount({
      providerType: "huggingface",
      providerExtra: {
        endpoint: "https://huggingface.co",
        model: "org/repo",
      },
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    });

    const page = await container.vfsService.listChildren({
      mount,
      parentSourceRef: null,
      limit: 10,
    });
    expect(page.items.map((item) => item.name)).toEqual(["onnx"]);
  } finally {
    globalThis.fetch = originalFetch;
    rmSync(dir, { recursive: true, force: true });
  }
});
