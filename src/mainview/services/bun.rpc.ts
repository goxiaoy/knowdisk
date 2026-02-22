import type { AppConfig, SourceConfig } from "../../core/config/config.types";
import type { ComponentHealth } from "../../core/health/health.service.types";
import type { IndexingStatus } from "../../core/indexing/indexing.service.types";
import type { RetrievalResult } from "../../core/retrieval/retrieval.service.types";
import type { VectorCollectionInspect } from "../../core/vector/vector.repository.types";

type AppBridgeSchema = {
  bun: {
    requests: {
      get_config: { params: void; response: AppConfig };
      update_config: { params: { config: AppConfig }; response: AppConfig };
      add_source: { params: { path: string }; response: SourceConfig[] };
      update_source: {
        params: { path: string; enabled: boolean };
        response: SourceConfig[];
      };
      remove_source: { params: { path: string }; response: SourceConfig[] };
      get_health: { params: void; response: Record<string, ComponentHealth> };
      get_index_status: { params: void; response: IndexingStatus };
      get_vector_stats: { params: void; response: VectorCollectionInspect };
      search_retrieval: { params: { query: string; topK: number }; response: RetrievalResult[] };
      retrieve_source_chunks: { params: { sourcePath: string }; response: RetrievalResult[] };
      list_source_files: { params: void; response: string[] };
      force_resync: { params: void; response: { ok: boolean; error?: string } };
      pick_source_directory_start: { params: void; response: { requestId: string } };
      pick_file_path_start: { params: void; response: { requestId: string } };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {
      pick_source_directory_result: { requestId: string; path: string | null; error?: string };
      pick_file_path_result: { requestId: string; path: string | null; error?: string };
    };
  };
};

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
    get_health: () => Promise<Record<string, ComponentHealth>>;
    get_index_status: () => Promise<IndexingStatus>;
    get_vector_stats: () => Promise<VectorCollectionInspect>;
    search_retrieval: (params: { query: string; topK: number }) => Promise<RetrievalResult[]>;
    retrieve_source_chunks: (params: { sourcePath: string }) => Promise<RetrievalResult[]>;
    list_source_files: () => Promise<string[]>;
    force_resync: () => Promise<{ ok: boolean; error?: string }>;
    pick_source_directory_start: () => Promise<{ requestId: string }>;
    pick_file_path_start: () => Promise<{ requestId: string }>;
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
  if (window.__electrobunBunBridge) {
    return window.__electrobunBunBridge;
  }
  const fallback =
    window.webkit?.messageHandlers?.bunBridge ??
    window.bunBridge ??
    window.chrome?.webview?.hostObjects?.bunBridge ??
    null;
  if (fallback) {
    window.__electrobunBunBridge = fallback;
  }
  return fallback;
}

async function getRpc() {
  if (rpc) return rpc;
  if (!resolveBridge()) {
    return null;
  }

  const mod = await import("electrobun/view");
  const next = mod.default.Electroview.defineRPC<AppBridgeSchema>({
    maxRequestTime: 120_000,
    handlers: {
      requests: {},
      messages: {
        pick_source_directory_result(payload) {
          const pending = pickSourcePending.get(payload.requestId);
          if (!pending) {
            return;
          }
          clearTimeout(pending.timeout);
          pickSourcePending.delete(payload.requestId);
          if (payload.error) {
            console.error("pick_source_directory async result error:", payload.error);
          }
          pending.resolve(payload.path ?? null);
        },
        pick_file_path_result(payload) {
          const pending = pickFilePending.get(payload.requestId);
          if (!pending) {
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

export async function getHealthFromBun(): Promise<Record<
  string,
  ComponentHealth
> | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.get_health();
  } catch {
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

export async function searchRetrievalInBun(
  query: string,
  topK: number,
): Promise<RetrievalResult[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.search_retrieval({ query, topK });
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
  try {
    const { requestId } = await channel.request.pick_source_directory_start();
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pickSourcePending.delete(requestId);
        console.error("pick_source_directory async callback timed out");
        resolve(null);
      }, 10 * 60 * 1000);
      pickSourcePending.set(requestId, { resolve, timeout });
    });
  } catch (error) {
    console.error("pick_source_directory RPC failed:", error);
    return null;
  }
}

export async function pickFilePathFromBun(): Promise<string | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    const { requestId } = await channel.request.pick_file_path_start();
    return await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        pickFilePending.delete(requestId);
        console.error("pick_file_path async callback timed out");
        resolve(null);
      }, 10 * 60 * 1000);
      pickFilePending.set(requestId, { resolve, timeout });
    });
  } catch (error) {
    console.error("pick_file_path RPC failed:", error);
    return null;
  }
}
