export type RendererVectorDbStatus = {
  available: boolean;
  chunkCount: number | null;
  lastUpdatedAt: string;
  error: string;
};

export const FALLBACK_VECTOR_DB_STATUS: RendererVectorDbStatus = {
  available: false,
  chunkCount: null,
  lastUpdatedAt: "",
  error: "",
};
