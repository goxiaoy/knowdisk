export type RendererIndexStatusPhase = "idle" | "indexing" | "rebuilding" | "error";

export type RendererIndexStatus = {
  available: boolean;
  phase: RendererIndexStatusPhase;
  scope: "incremental" | "full" | null;
  processedFiles: number;
  totalFiles: number;
  activeNodeName: string;
  error: string;
};

export const FALLBACK_INDEX_STATUS: RendererIndexStatus = {
  available: false,
  phase: "idle",
  scope: null,
  processedFiles: 0,
  totalFiles: 0,
  activeNodeName: "",
  error: "",
};
