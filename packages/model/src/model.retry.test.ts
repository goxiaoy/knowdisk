import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
  it("persists partial chunks and resumes after stream interruption", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-stream-resume-"));
    tempDirs.push(dir);

    const config = createDefaultCoreConfig();
    config.providers.huggingface = {
      endpoint: "https://models.example.com",
    };
    config.reranker.enabled = false;

    let downloadAttempt = 0;
    const fetchImpl = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/models/onnx-community/gte-multilingual-base")) {
        return jsonResponse({
          siblings: [{ rfilename: "onnx/model.onnx", size: 8 }],
        });
      }

      downloadAttempt += 1;
      if (downloadAttempt === 1) {
        let sent = false;
        const stream = new ReadableStream<Uint8Array>({
          pull(controller) {
            if (!sent) {
              sent = true;
              controller.enqueue(new TextEncoder().encode("test"));
              return;
            }
            controller.error(new Error("stream interrupted"));
          },
        });
        return new Response(stream, {
          status: 200,
          headers: {
            "content-length": "8",
            "content-type": "application/octet-stream",
          },
        });
      }

      const headers = new Headers(init?.headers);
      if (headers.get("range") !== "bytes=4-") {
        throw new Error("missing resume range header");
      }
      return new Response("done", {
        status: 206,
        headers: {
          "content-length": "4",
          "content-range": "bytes 4-7/8",
          "content-type": "application/octet-stream",
        },
      });
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
      },
    });

    await expect(service.ensureRequiredModels()).rejects.toThrow("stream interrupted");

    const partial = await readFile(
      join(dir, "embedding", "onnx-community/gte-multilingual-base", "onnx", "model.onnx.part"),
      "utf8"
    );
    expect(partial).toBe("test");

    await service.ensureRequiredModels();

    const result = await readFile(
      join(dir, "embedding", "onnx-community/gte-multilingual-base", "onnx", "model.onnx"),
      "utf8"
    );
    expect(result).toBe("testdone");
  });

  it("resumes download from existing part file with range request", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-resume-"));
    tempDirs.push(dir);

    const config = createDefaultCoreConfig();
    config.providers.huggingface = {
      endpoint: "https://models.example.com",
    };
    config.reranker.enabled = false;

    const modelPath = join(
      dir,
      "embedding",
      "onnx-community/gte-multilingual-base",
      "onnx/model.onnx.part"
    );
    await mkdir(dirname(modelPath), { recursive: true });
    await writeFile(modelPath, "test", "utf8");

    const fetchImpl = mock(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith("/api/models/onnx-community/gte-multilingual-base")) {
        return jsonResponse({
          siblings: [{ rfilename: "onnx/model.onnx", size: 8 }],
        });
      }
      const headers = new Headers(init?.headers);
      if (headers.get("range") !== "bytes=4-") {
        throw new Error("missing range header");
      }
      return new Response("done", {
        status: 206,
        headers: {
          "content-length": "4",
          "content-range": "bytes 4-7/8",
          "content-type": "application/octet-stream",
        },
      });
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

    await service.ensureRequiredModels();

    const result = await readFile(
      join(dir, "embedding", "onnx-community/gte-multilingual-base", "onnx", "model.onnx"),
      "utf8"
    );
    expect(result).toBe("testdone");
  });

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

  it("weights aggregate progress by total bytes and marks queued tasks as waiting", async () => {
    const dir = await mkdtemp(join(tmpdir(), "knowdisk-model-weighted-progress-"));
    tempDirs.push(dir);

    const config = createDefaultCoreConfig();
    config.providers.huggingface = {
      endpoint: "https://models.example.com",
    };

    const snapshots: Array<{
      phase: string;
      progressPct: number;
      embeddingProgress: number;
      embeddingState: string;
      rerankerProgress: number;
      rerankerState: string;
      rerankerTotal: number;
    }> = [];

    const fetchImpl = mock(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith("/api/models/onnx-community/gte-multilingual-base")) {
        return jsonResponse({
          siblings: [{ rfilename: "onnx/model.onnx", size: 4 }],
        });
      }
      if (url.endsWith("/api/models/Xenova/bge-reranker-base")) {
        return jsonResponse({
          siblings: [{ rfilename: "onnx/model.onnx", size: 12 }],
        });
      }
      if (url.includes("/onnx-community/gte-multilingual-base/resolve/main/")) {
        return textResponse("test", 4);
      }
      if (url.includes("/Xenova/bge-reranker-base/resolve/main/")) {
        return textResponse("abcdefghijkl", 12);
      }
      throw new Error(`unexpected fetch url: ${url}`);
    });

    const service = createModelService({
      logger: createLoggerService({ level: "silent" }),
      config,
      cacheDir: dir,
      deps: {
        fetch: fetchImpl,
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

    const unsubscribe = service.getStatus().subscribe((status) => {
      snapshots.push({
        phase: status.phase,
        progressPct: status.progressPct,
        embeddingProgress: status.tasks.embedding?.progressPct ?? 0,
        embeddingState: status.tasks.embedding?.state ?? "none",
        rerankerProgress: status.tasks.reranker?.progressPct ?? 0,
        rerankerState: status.tasks.reranker?.state ?? "none",
        rerankerTotal: status.tasks.reranker?.totalBytes ?? 0,
      });
    });
    await service.ensureRequiredModels();
    unsubscribe();

    const queuedSnapshot = snapshots.find(
      (snapshot) =>
        snapshot.phase === "running" &&
        snapshot.embeddingProgress === 100 &&
        snapshot.rerankerProgress === 0 &&
        snapshot.rerankerTotal === 12
    );

    expect(queuedSnapshot).toBeTruthy();
    expect(queuedSnapshot?.rerankerState).toBe("waiting");
    expect(queuedSnapshot?.progressPct).toBe(25);
  });
});
