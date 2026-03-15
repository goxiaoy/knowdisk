import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
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

describe("model redownload APIs", () => {
  it("redownloadEmbeddingModel refreshes only the embedding cache tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-redownload-"));
    tempDirs.push(dir);

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: dir,
      deps: {
        fetch: createFetchStub(),
        loadEmbeddingExtractor: async () => async () => ({ data: [1] }),
        loadRerankerRuntime: async () => ({
          async tokenizePairs() {
            return {};
          },
          async score() {
            return [1];
          },
        }),
      },
    });

    await service.ensureRequiredModels();
    await service.redownloadEmbeddingModel();

    const embeddingDirs = await readdir(join(dir, "embedding"));
    const rerankerDirs = await readdir(join(dir, "reranker"));

    expect(embeddingDirs.length).toBe(1);
    expect(rerankerDirs.length).toBe(1);
  });

  it("redownloadRerankerModel refreshes only the reranker cache tree", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-redownload-"));
    tempDirs.push(dir);

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config: createDefaultCoreConfig(),
      cacheDir: dir,
      deps: {
        fetch: createFetchStub(),
        loadEmbeddingExtractor: async () => async () => ({ data: [1] }),
        loadRerankerRuntime: async () => ({
          async tokenizePairs() {
            return {};
          },
          async score() {
            return [1];
          },
        }),
      },
    });

    await service.ensureRequiredModels();
    await service.redownloadRerankerModel();

    const embeddingDirs = await readdir(join(dir, "embedding"));
    const rerankerDirs = await readdir(join(dir, "reranker"));

    expect(embeddingDirs.length).toBe(1);
    expect(rerankerDirs.length).toBe(1);
  });
});
