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
  id: string;
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
  tasks: Record<string, ModelTaskStatus | null>;
};

export const FALLBACK_MODEL_STATUS: RendererModelStatus = {
  phase: "idle",
  progressPct: 0,
  error: "",
  available: false,
  tasks: {},
};

export function clampPct(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.max(0, Math.min(100, Math.round(value)));
}
