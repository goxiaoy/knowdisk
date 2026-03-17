export type RendererIndexStatusPhase = "idle" | "indexing" | "error";

export type RendererIndexStatus = {
  available: boolean;
  phase: RendererIndexStatusPhase;
  scope: "incremental" | null;
  queueDepth: number;
  processedFiles: number;
  totalFiles: number;
  activeNodeName: string;
  error: string;
};

export const FALLBACK_INDEX_STATUS: RendererIndexStatus = {
  available: false,
  phase: "idle",
  scope: null,
  queueDepth: 0,
  processedFiles: 0,
  totalFiles: 0,
  activeNodeName: "",
  error: "",
};
