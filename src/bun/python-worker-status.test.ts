import { describe, expect, test } from "bun:test";
import { createPythonWorkerStatusStore } from "./python-worker-status";

describe("createPythonWorkerStatusStore", () => {
  test("starts from unavailable fallback statuses", () => {
    const store = createPythonWorkerStatusStore();

    expect(store.getModelStatus()).toEqual({
      phase: "idle",
      progressPct: 0,
      error: "",
      available: false,
      tasks: {
        embedding: null,
        reranker: null,
      },
    });
    expect(store.getIndexStatus()).toEqual({
      available: false,
      phase: "idle",
      scope: null,
      queueDepth: 0,
      processedFiles: 0,
      totalFiles: 0,
      activeNodeName: "",
      error: "",
    });
    expect(store.getVectorDbStatus()).toEqual({
      available: false,
      chunkCount: null,
      lastUpdatedAt: "",
      error: "",
    });
  });

  test("hydrates all statuses from runtime snapshot", () => {
    const store = createPythonWorkerStatusStore();

    store.applyEvent({
      type: "statusSnapshot",
      payload: {
        model_status: {
          phase: "completed",
          progressPct: 100,
          error: "",
          available: true,
          tasks: {
            embedding: {
              id: "embedding-local",
              model: "embed",
              state: "ready",
              progressPct: 100,
              error: "",
            },
            reranker: null,
          },
        },
        index_status: {
          available: true,
          phase: "indexing",
          scope: "incremental",
          queueDepth: 2,
          processedFiles: 3,
          totalFiles: 5,
          activeNodeName: "note.md",
          error: "",
        },
        vector_status: {
          available: true,
          chunkCount: 42,
          lastUpdatedAt: "2026-03-17T00:00:00Z",
          error: "",
        },
      },
    });

    expect(store.getModelStatus().phase).toBe("completed");
    expect(store.getModelStatus().tasks.embedding?.model).toBe("embed");
    expect(store.getIndexStatus()).toEqual({
      available: true,
      phase: "indexing",
      scope: "incremental",
      queueDepth: 2,
      processedFiles: 3,
      totalFiles: 5,
      activeNodeName: "note.md",
      error: "",
    });
    expect(store.getVectorDbStatus()).toEqual({
      available: true,
      chunkCount: 42,
      lastUpdatedAt: "2026-03-17T00:00:00Z",
      error: "",
    });
  });

  test("applies incremental status events without resetting other domains", () => {
    const store = createPythonWorkerStatusStore();

    store.applyEvent({
      type: "model_status_changed",
      payload: {
        phase: "verifying",
        progressPct: 12,
        error: "",
        available: true,
        tasks: {
          embedding: null,
          reranker: null,
        },
      },
    });
    store.applyEvent({
      type: "index_status_changed",
      payload: {
        available: true,
        phase: "indexing",
        scope: "incremental",
        queueDepth: 4,
        processedFiles: 10,
        totalFiles: 10,
        activeNodeName: "report.pdf",
        error: "",
      },
    });

    expect(store.getModelStatus().phase).toBe("verifying");
    expect(store.getIndexStatus().activeNodeName).toBe("report.pdf");
    expect(store.getVectorDbStatus().available).toBe(false);
  });

  test("resets all statuses back to fallback", () => {
    const store = createPythonWorkerStatusStore();
    store.applyEvent({
      type: "model_status_changed",
      payload: {
        phase: "running",
        progressPct: 50,
        error: "",
        available: true,
        tasks: {
          embedding: null,
          reranker: null,
        },
      },
    });

    store.reset();

    expect(store.getModelStatus().available).toBe(false);
    expect(store.getIndexStatus().available).toBe(false);
    expect(store.getVectorDbStatus().available).toBe(false);
  });
});
