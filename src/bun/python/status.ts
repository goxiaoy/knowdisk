import { FALLBACK_INDEX_STATUS, type RendererIndexStatus } from "../../shared/index-status";
import { FALLBACK_MODEL_STATUS, type RendererModelStatus } from "../../shared/model-status";
import type { PythonWorkerEvent } from "../../shared/python-worker";
import { FALLBACK_VECTOR_DB_STATUS, type RendererVectorDbStatus } from "../../shared/vector-db-status";

type PythonWorkerSnapshot = {
  model_status?: RendererModelStatus;
  index_status?: RendererIndexStatus;
  vector_status?: RendererVectorDbStatus;
};

export function createPythonWorkerStatusStore() {
  let modelStatus: RendererModelStatus = FALLBACK_MODEL_STATUS;
  let indexStatus: RendererIndexStatus = FALLBACK_INDEX_STATUS;
  let vectorDbStatus: RendererVectorDbStatus = FALLBACK_VECTOR_DB_STATUS;

  return {
    getModelStatus(): RendererModelStatus {
      return modelStatus;
    },

    getIndexStatus(): RendererIndexStatus {
      return indexStatus;
    },

    getVectorDbStatus(): RendererVectorDbStatus {
      return vectorDbStatus;
    },

    reset(): void {
      modelStatus = FALLBACK_MODEL_STATUS;
      indexStatus = FALLBACK_INDEX_STATUS;
      vectorDbStatus = FALLBACK_VECTOR_DB_STATUS;
    },

    applyEvent(event: { type: "statusSnapshot"; payload: unknown } | PythonWorkerEvent): void {
      if (event.type === "statusSnapshot") {
        const snapshot = event.payload as PythonWorkerSnapshot;
        modelStatus = normalizeModelStatus(snapshot.model_status);
        indexStatus = normalizeIndexStatus(snapshot.index_status);
        vectorDbStatus = normalizeVectorDbStatus(snapshot.vector_status);
        return;
      }

      if (event.type === "model_status_changed") {
        modelStatus = normalizeModelStatus(event.payload as RendererModelStatus);
      }
      if (event.type === "index_status_changed") {
        indexStatus = normalizeIndexStatus(event.payload as RendererIndexStatus);
      }
      if (event.type === "vector_status_changed") {
        vectorDbStatus = normalizeVectorDbStatus(event.payload as RendererVectorDbStatus);
      }
    },
  };
}

function normalizeModelStatus(status?: RendererModelStatus): RendererModelStatus {
  return {
    ...FALLBACK_MODEL_STATUS,
    ...status,
    tasks: { ...(status?.tasks ?? {}) },
  };
}

function normalizeIndexStatus(status?: RendererIndexStatus): RendererIndexStatus {
  return {
    ...FALLBACK_INDEX_STATUS,
    ...status,
  };
}

function normalizeVectorDbStatus(status?: RendererVectorDbStatus): RendererVectorDbStatus {
  return {
    ...FALLBACK_VECTOR_DB_STATUS,
    ...status,
  };
}
