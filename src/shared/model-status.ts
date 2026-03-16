export type ModelTaskState =
  | "verifying"
  | "waiting"
  | "pending"
  | "downloading"
  | "ready"
  | "failed"
  | "skipped";

export type ModelPhase = "idle" | "verifying" | "running" | "completed" | "failed";

export type ModelTaskStatus = {
  id: "embedding-local" | "reranker-local";
  model: string;
  state: ModelTaskState;
  progressPct: number;
  error: string;
};

export type RendererModelStatus = {
  phase: ModelPhase;
  progressPct: number;
  error: string;
  available: boolean;
  tasks: {
    embedding: ModelTaskStatus | null;
    reranker: ModelTaskStatus | null;
  };
};

export const FALLBACK_MODEL_STATUS: RendererModelStatus = {
  phase: "idle",
  progressPct: 0,
  error: "",
  available: false,
  tasks: {
    embedding: null,
    reranker: null,
  },
};

export function clampPct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}
