import type { AppConfig, SourceConfig } from "../../core/config/config.types";
import type { IndexingStatus } from "../../core/indexing/indexing.service.types";
import type { ModelDownloadStatus } from "../../core/model/model-download.service.types";
import type { RetrievalResult } from "../../core/retrieval/retrieval.service.types";
import type { RetrievalDebugResult } from "../../core/retrieval/retrieval.service.types";
import type { VectorCollectionInspect } from "../../core/vector/vector.repository.types";

type BridgeRpc = {
  request: {
    get_config: () => Promise<AppConfig>;
    update_config: (params: { config: AppConfig }) => Promise<AppConfig>;
    add_source: (params: { path: string }) => Promise<SourceConfig[]>;
    update_source: (params: {
      path: string;
      enabled: boolean;
    }) => Promise<SourceConfig[]>;
    remove_source: (params: { path: string }) => Promise<SourceConfig[]>;
    get_index_status: () => Promise<IndexingStatus>;
    get_vector_stats: () => Promise<VectorCollectionInspect>;
    get_model_download_status: () => Promise<ModelDownloadStatus>;
    retry_model_download: () => Promise<{ ok: boolean; reason: string }>;
    redownload_model_download: (params: {
      taskId: "embedding-local" | "reranker-local";
    }) => Promise<{ ok: boolean; reason: string }>;
    search_retrieval: (params: {
      query: string;
      topK: number;
      titleOnly?: boolean;
    }) => Promise<RetrievalDebugResult>;
    retrieve_source_chunks: (params: { sourcePath: string }) => Promise<RetrievalResult[]>;
    list_source_files: () => Promise<string[]>;
    force_resync: () => Promise<{ ok: boolean; error?: string }>;
    install_claude_mcp: () => Promise<{ ok: boolean; path?: string; error?: string }>;
    pick_source_directory_start: (params: { requestId: string }) => Promise<{ ok: boolean }>;
    pick_file_path_start: (params: { requestId: string }) => Promise<{ ok: boolean }>;
  };
};

let rpc: BridgeRpc | null = null;
const pickSourcePending = new Map<
  string,
  { resolve: (path: string | null) => void; timeout: ReturnType<typeof setTimeout> }
>();
const pickFilePending = new Map<
  string,
  { resolve: (path: string | null) => void; timeout: ReturnType<typeof setTimeout> }
>();

function resolveBridge() {
  if (typeof window === "undefined") {
    return null;
  }
  const w = window as Window & {
    __electrobunBunBridge?: unknown;
    bunBridge?: unknown;
    webkit?: { messageHandlers?: { bunBridge?: unknown } };
    chrome?: { webview?: { hostObjects?: { bunBridge?: unknown } } };
  };
  if (w.__electrobunBunBridge) {
    return w.__electrobunBunBridge;
  }
  const fallback =
    w.webkit?.messageHandlers?.bunBridge ??
    w.bunBridge ??
    w.chrome?.webview?.hostObjects?.bunBridge ??
    null;
  if (fallback) {
    (w as any).__electrobunBunBridge = fallback;
  }
  return fallback;
}

async function getRpc() {
  if (rpc) return rpc;
  if (!resolveBridge()) {
    return null;
  }

  const mod = await import("electrobun/view");
  const next = mod.default.Electroview.defineRPC({
    maxRequestTime: 120_000,
    handlers: {
      requests: {},
      messages: {
        pick_source_directory_result(payload: {
          requestId: string;
          path: string | null;
          error?: string;
        }) {
          const pending = pickSourcePending.get(payload.requestId);
          if (!pending) {
            console.error("pick_source_directory async result dropped: unknown requestId", payload.requestId);
            return;
          }
          clearTimeout(pending.timeout);
          pickSourcePending.delete(payload.requestId);
          if (payload.error) {
            console.error("pick_source_directory async result error:", payload.error);
          }
          pending.resolve(payload.path ?? null);
        },
        pick_file_path_result(payload: {
          requestId: string;
          path: string | null;
          error?: string;
        }) {
          const pending = pickFilePending.get(payload.requestId);
          if (!pending) {
            console.error("pick_file_path async result dropped: unknown requestId", payload.requestId);
            return;
          }
          clearTimeout(pending.timeout);
          pickFilePending.delete(payload.requestId);
          if (payload.error) {
            console.error("pick_file_path async result error:", payload.error);
          }
          pending.resolve(payload.path ?? null);
        },
      },
    },
  });
  new mod.default.Electroview({ rpc: next });
  rpc = next as BridgeRpc;
  return next as BridgeRpc;
}

export async function getConfigFromBun(): Promise<AppConfig | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.get_config();
  } catch {
    return null;
  }
}

export async function updateConfigInBun(config: AppConfig): Promise<void> {
  const channel = await getRpc();
  if (!channel) return;
  try {
    await channel.request.update_config({ config });
  } catch {
    return;
  }
}

export async function addSourceInBun(
  path: string,
): Promise<SourceConfig[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.add_source({ path });
  } catch (error) {
    console.error("add_source RPC failed:", error);
    return null;
  }
}

export async function updateSourceInBun(
  path: string,
  enabled: boolean,
): Promise<SourceConfig[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.update_source({ path, enabled });
  } catch (error) {
    console.error("update_source RPC failed:", error);
    return null;
  }
}

export async function removeSourceInBun(
  path: string,
): Promise<SourceConfig[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.remove_source({ path });
  } catch (error) {
    console.error("remove_source RPC failed:", error);
    return null;
  }
}

export async function getIndexStatusFromBun(): Promise<IndexingStatus | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.get_index_status();
  } catch {
    return null;
  }
}

export async function getVectorStatsFromBun(): Promise<VectorCollectionInspect | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.get_vector_stats();
  } catch {
    return null;
  }
}

export async function getModelDownloadStatusFromBun(): Promise<ModelDownloadStatus | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.get_model_download_status();
  } catch {
    return null;
  }
}

export async function retryModelDownloadInBun(): Promise<{ ok: boolean; reason: string } | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.retry_model_download();
  } catch {
    return null;
  }
}

export async function redownloadModelInBun(
  taskId: "embedding-local" | "reranker-local",
): Promise<{ ok: boolean; reason: string } | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.redownload_model_download({ taskId });
  } catch (error) {
    console.error("redownload_model_download RPC failed:", error);
    return null;
  }
}

export async function searchRetrievalInBun(
  query: string,
  topK: number,
  titleOnly = false,
): Promise<RetrievalDebugResult | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.search_retrieval({ query, topK, titleOnly });
  } catch (error) {
    console.error("search_retrieval RPC failed:", error);
    return null;
  }
}

export async function forceResyncInBun(): Promise<{ ok: boolean; error?: string } | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.force_resync();
  } catch {
    return null;
  }
}

export async function installClaudeMcpInBun(): Promise<{ ok: boolean; path?: string; error?: string } | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.install_claude_mcp();
  } catch (error) {
    console.error("install_claude_mcp RPC failed:", error);
    return null;
  }
}

export async function retrieveSourceChunksInBun(
  sourcePath: string,
): Promise<RetrievalResult[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.retrieve_source_chunks({ sourcePath });
  } catch (error) {
    console.error("retrieve_source_chunks RPC failed:", error);
    return null;
  }
}

export async function listSourceFilesInBun(): Promise<string[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.list_source_files();
  } catch (error) {
    console.error("list_source_files RPC failed:", error);
    return null;
  }
}

export async function pickSourceDirectoryFromBun(): Promise<string | null> {
  const channel = await getRpc();
  if (!channel) return null;
  const requestId = globalThis.crypto.randomUUID();
  const responsePromise = new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      pickSourcePending.delete(requestId);
      console.error("pick_source_directory async callback timed out");
      resolve(null);
    }, 10 * 60 * 1000);
    pickSourcePending.set(requestId, { resolve, timeout });
  });
  try {
    await channel.request.pick_source_directory_start({ requestId });
    return await responsePromise;
  } catch (error) {
    const pending = pickSourcePending.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pickSourcePending.delete(requestId);
      pending.resolve(null);
    }
    console.error("pick_source_directory RPC failed:", error);
    return null;
  }
}

export async function pickFilePathFromBun(): Promise<string | null> {
  const channel = await getRpc();
  if (!channel) return null;
  const requestId = globalThis.crypto.randomUUID();
  const responsePromise = new Promise<string | null>((resolve) => {
    const timeout = setTimeout(() => {
      pickFilePending.delete(requestId);
      console.error("pick_file_path async callback timed out");
      resolve(null);
    }, 10 * 60 * 1000);
    pickFilePending.set(requestId, { resolve, timeout });
  });
  try {
    await channel.request.pick_file_path_start({ requestId });
    return await responsePromise;
  } catch (error) {
    const pending = pickFilePending.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      pickFilePending.delete(requestId);
      pending.resolve(null);
    }
    console.error("pick_file_path RPC failed:", error);
    return null;
  }
}
