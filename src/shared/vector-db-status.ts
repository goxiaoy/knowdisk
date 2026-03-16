export type RendererVectorDbStatus = {
  available: boolean;
  chunkCount: number | null;
};

export const FALLBACK_VECTOR_DB_STATUS: RendererVectorDbStatus = {
  available: false,
  chunkCount: null,
};
