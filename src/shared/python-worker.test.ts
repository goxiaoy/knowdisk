import { expect, test } from "bun:test";
import {
  isPythonWorkerEventFrame,
  isPythonWorkerRequestFrame,
  isPythonWorkerResponseFrame,
  isPythonWorkerStartRequestFrame,
} from "./python-worker";

test("accepts valid python worker request frames", () => {
  expect(
    isPythonWorkerRequestFrame({
      id: "req-1",
      method: "index_node",
      params: { nodeId: "node-1" },
    })
  ).toBe(true);

  expect(
    isPythonWorkerStartRequestFrame({
      id: "req-start",
      method: "start",
      params: {
        basePath: "/tmp/knowdisk",
        embeddingModel: "Alibaba-NLP/gte-multilingual-base",
        rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
        preferredDevice: "cpu",
        huggingfaceEndpoint: "https://huggingface.co",
        coreConfig: {
          embedding: {
            provider: "local",
            local: {
              model: "Alibaba-NLP/gte-multilingual-base",
              dimension: 768,
            },
          },
          reranker: {
            enabled: true,
            provider: "local",
            local: {
              model: "Alibaba-NLP/gte-multilingual-reranker-base",
              topN: 5,
            },
          },
          providers: {
            huggingface: {
              endpoint: "https://huggingface.co",
            },
          },
        },
      },
    })
  ).toBe(true);
});

test("accepts valid python worker response frames", () => {
  expect(
    isPythonWorkerResponseFrame({
      id: "req-1",
      result: { ok: true },
    })
  ).toBe(true);

  expect(
    isPythonWorkerResponseFrame({
      id: "req-2",
      error: {
        code: "WORKER_ERROR",
        message: "boom",
      },
    })
  ).toBe(true);
});

test("accepts valid python worker event frames", () => {
  expect(
    isPythonWorkerEventFrame({
      type: "index_status_changed",
      payload: {
        phase: "indexing",
      },
    })
  ).toBe(true);
});

test("rejects malformed python worker frames", () => {
  expect(isPythonWorkerRequestFrame(null)).toBe(false);
  expect(isPythonWorkerRequestFrame({ id: 1, method: "start", params: {} })).toBe(false);
  expect(isPythonWorkerResponseFrame({ id: "req-1" })).toBe(false);
  expect(isPythonWorkerResponseFrame({ id: "req-1", result: {}, error: {} })).toBe(false);
  expect(isPythonWorkerEventFrame({ type: "", payload: {} })).toBe(false);
  expect(
    isPythonWorkerStartRequestFrame({
      id: "req-start",
      method: "start",
      params: {
        rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
        basePath: "/tmp/knowdisk",
        preferredDevice: "cpu",
      },
    })
  ).toBe(false);
  expect(
    isPythonWorkerStartRequestFrame({
      id: "req-start",
      method: "start",
      params: {
        basePath: "/tmp/knowdisk",
        embeddingModel: "Alibaba-NLP/gte-multilingual-base",
        rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
        preferredDevice: "beam",
      },
    })
  ).toBe(false);
});
