import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultCoreConfig, createLoggerService } from "@knowdisk/core";
import { createModelService } from "./index";

function jsonResponse(payload: unknown) {
  return new Response(JSON.stringify(payload), {
    status: 200,
    headers: {
      "content-type": "application/json",
    },
  });
}

function textResponse(body: string, total: number) {
  return new Response(body, {
    status: 200,
    headers: {
      "content-length": String(total),
      "content-type": "application/octet-stream",
    },
  });
}

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("model retry and progress", () => {
  it("updates retry metadata when download fails", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-retry-"));
    tempDirs.push(dir);

    const config = createDefaultCoreConfig();
    config.providers.huggingface = {
      endpoint: "https://models.example.com",
    };

    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/models/onnx-community/gte-multilingual-base")) {
        return jsonResponse({
          siblings: [{ rfilename: "onnx/model.onnx", size: 4 }],
        });
      }
      throw new Error("network timeout");
    });

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config,
      cacheDir: dir,
      deps: {
        fetch: fetchImpl,
        setTimeout: ((_fn: () => void, _delay?: number) => 1) as typeof setTimeout,
        clearTimeout: ((_timer: number) => {}) as typeof clearTimeout,
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

    await expect(service.ensureRequiredModels()).rejects.toThrow("network timeout");

    expect(service.getStatus().getSnapshot()).toMatchObject({
      phase: "failed",
      retry: {
        attempt: 1,
        nextRetryAt: expect.any(String),
        exhausted: false,
      },
    });
  });

  it("tracks progress while downloading required files", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-progress-"));
    tempDirs.push(dir);

    const config = createDefaultCoreConfig();
    config.providers.huggingface = {
      endpoint: "https://models.example.com",
    };
    config.reranker.enabled = false;

    const events: number[] = [];
    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/models/onnx-community/gte-multilingual-base")) {
        return jsonResponse({
          siblings: [{ rfilename: "onnx/model.onnx", size: 4 }],
        });
      }
      return textResponse("test", 4);
    });

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config,
      cacheDir: dir,
      deps: {
        fetch: fetchImpl,
        loadEmbeddingExtractor: async () => async () => ({ data: [1] }),
      },
    });

    const unsubscribe = service.getStatus().subscribe((status) => {
      events.push(status.progressPct);
    });
    await service.ensureRequiredModels();
    unsubscribe();

    expect(events.some((value) => value > 0)).toBe(true);
    expect(service.getStatus().getSnapshot()).toMatchObject({
      phase: "completed",
      progressPct: 100,
    });
  });
});
