import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultCoreConfig, createLoggerService } from "@knowdisk/core";
import { createModelService } from "./index";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function createFetchStub() {
  return async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/models/")) {
      return new Response(
        JSON.stringify({
          siblings: [{ rfilename: "onnx/model.onnx", size: 4 }],
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    }
    return new Response("test", {
      status: 200,
      headers: {
        "content-length": "4",
        "content-type": "application/octet-stream",
      },
    });
  };
}

describe("model runtime acquisition", () => {
  it("verifies local runtimes after model download completes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-verify-"));
    tempDirs.push(dir);
    const embeddingLoader = mock(async () => async () => ({ data: [1] }));
    const rerankerLoader = mock(async () => ({
      async tokenizePairs() {
        return {};
      },
      async score() {
        return [1];
      },
    }));

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: dir,
      deps: {
        fetch: createFetchStub(),
        loadEmbeddingExtractor: embeddingLoader,
        loadRerankerRuntime: rerankerLoader,
      },
    });

    await service.ensureRequiredModels();

    expect(embeddingLoader).toHaveBeenCalledTimes(1);
    expect(rerankerLoader).toHaveBeenCalledTimes(1);
  });

  it("reuses cached models on the next startup without downloading again", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-reuse-"));
    tempDirs.push(dir);
    const fetchImpl = mock(createFetchStub());
    const firstEmbeddingLoader = mock(async () => async () => ({ data: [1] }));
    const firstRerankerLoader = mock(async () => ({
      async tokenizePairs() {
        return {};
      },
      async score() {
        return [1];
      },
    }));

    const firstService = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: dir,
      deps: {
        fetch: fetchImpl,
        loadEmbeddingExtractor: firstEmbeddingLoader,
        loadRerankerRuntime: firstRerankerLoader,
      },
    });

    await firstService.ensureRequiredModels();
    expect(fetchImpl).toHaveBeenCalledTimes(4);

    const secondEmbeddingLoader = mock(async () => async () => ({ data: [2] }));
    const secondRerankerLoader = mock(async () => ({
      async tokenizePairs() {
        return {};
      },
      async score() {
        return [2];
      },
    }));
    const secondService = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: dir,
      deps: {
        fetch: fetchImpl,
        loadEmbeddingExtractor: secondEmbeddingLoader,
        loadRerankerRuntime: secondRerankerLoader,
      },
    });

    await secondService.ensureRequiredModels();

    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(secondEmbeddingLoader).toHaveBeenCalledTimes(1);
    expect(secondRerankerLoader).toHaveBeenCalledTimes(1);
  });

  it("rejects embedding runtime when embedding provider is not local", async () => {
    const config = createDefaultCoreConfig();
    config.embedding.provider = "openai";

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config,
      cacheDir: "build/models",
    });

    await expect(service.getLocalEmbeddingExtractor()).rejects.toThrow(
      "Local embedding provider is not enabled"
    );
  });

  it("loads embedding runtime once for concurrent callers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-embedding-"));
    tempDirs.push(dir);
    const loader = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return async () => ({ data: [1, 2, 3] });
    });

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: dir,
      deps: {
        fetch: createFetchStub(),
        loadEmbeddingExtractor: loader,
      },
    });

    const [a, b] = await Promise.all([
      service.getLocalEmbeddingExtractor(),
      service.getLocalEmbeddingExtractor(),
    ]);

    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("loads reranker runtime once for concurrent callers", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-reranker-"));
    tempDirs.push(dir);
    const loader = mock(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {
        async tokenizePairs() {
          return {};
        },
        async score() {
          return [1];
        },
      };
    });

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: dir,
      deps: {
        fetch: createFetchStub(),
        loadRerankerRuntime: loader,
      },
    });

    const [a, b] = await Promise.all([
      service.getLocalRerankerRuntime(),
      service.getLocalRerankerRuntime(),
    ]);

    expect(a).toBe(b);
    expect(loader).toHaveBeenCalledTimes(1);
  });
});
