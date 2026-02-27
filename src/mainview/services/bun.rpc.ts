import type { AppConfig, SourceConfig } from "../../core/config/config.types";
import type { IndexingStatus } from "../../core/indexing/indexing.service.types";
import type { ModelDownloadStatus } from "../../core/model/model-download.service.types";
import type { RetrievalResult } from "../../core/retrieval/retrieval.service.types";
import type { RetrievalDebugResult } from "../../core/retrieval/retrieval.service.types";
import type { VectorCollectionInspect } from "../../core/vector/vector.repository.types";
import type { ChatCitation, ChatMessage, ChatSession } from "../../core/chat/chat.repository.types";
import type { VfsCursor, VfsMountConfig, VfsNode } from "@knowdisk/vfs";

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
    retry_model_download: () => Promise<{ ok: boolean }>;
    redownload_model_download: (params: {
      taskId: "embedding-local" | "reranker-local";
    }) => Promise<{ ok: boolean }>;
    search_retrieval: (params: {
      query: string;
      topK: number;
      titleOnly?: boolean;
    }) => Promise<RetrievalDebugResult>;
    retrieve_source_chunks: (params: { sourcePath: string }) => Promise<RetrievalResult[]>;
    list_source_files: () => Promise<string[]>;
    force_resync: () => Promise<{ ok: boolean; error?: string }>;
    vfs_mount: (params: { config: VfsMountConfig }) => Promise<{ ok: boolean }>;
    vfs_walk_children: (params: {
      path: string;
      limit: number;
      cursor?: VfsCursor;
    }) => Promise<{ items: VfsNode[]; nextCursor?: VfsCursor; source: "local" | "remote" }>;
    vfs_trigger_reconcile: (params: { mountId: string }) => Promise<{ ok: boolean }>;
    install_claude_mcp: () => Promise<{ ok: boolean; path?: string; error?: string }>;
    pick_source_directory_start: (params: { requestId: string }) => Promise<{ ok: boolean }>;
    pick_file_path_start: (params: { requestId: string }) => Promise<{ ok: boolean }>;
    chat_list_sessions: () => Promise<ChatSession[]>;
    chat_create_session: (params?: { title?: string }) => Promise<ChatSession>;
    chat_rename_session: (params: { sessionId: string; title: string }) => Promise<{ ok: boolean }>;
    chat_delete_session: (params: { sessionId: string }) => Promise<{ ok: boolean }>;
    chat_list_messages: (params: { sessionId: string }) => Promise<Array<ChatMessage & { citations?: ChatCitation[] }>>;
    chat_send_message_start: (params: { requestId: string; sessionId: string; content: string }) => Promise<{ ok: boolean }>;
    chat_stop_stream: (params: { requestId: string }) => Promise<{ ok: boolean }>;
    chat_fetch_openai_models: (params: { apiKey: string; domain: string }) => Promise<{ models: string[] }>;
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
const chatStreamPending = new Map<
  string,
  {
    onChunk: (chunk: string) => void;
    resolve: (result: { message: ChatMessage; citations: ChatCitation[] }) => void;
    reject: (error: Error) => void;
    timeout: ReturnType<typeof setTimeout>;
  }
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
        chat_stream_event(payload: {
          requestId: string;
          event:
            | { type: "chunk"; content: string }
            | { type: "done"; message: ChatMessage; citations: ChatCitation[] }
            | { type: "error"; error: string };
        }) {
          const pending = chatStreamPending.get(payload.requestId);
          if (!pending) {
            return;
          }
          if (payload.event.type === "chunk") {
            pending.onChunk(payload.event.content);
            return;
          }
          clearTimeout(pending.timeout);
          chatStreamPending.delete(payload.requestId);
          if (payload.event.type === "done") {
            pending.resolve({ message: payload.event.message, citations: payload.event.citations });
            return;
          }
          pending.reject(new Error(payload.event.error));
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

export async function retryModelDownloadInBun(): Promise<{ ok: boolean } | null> {
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
): Promise<{ ok: boolean } | null> {
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

export async function mountVfsInBun(config: VfsMountConfig): Promise<boolean> {
  const channel = await getRpc();
  if (!channel) return false;
  try {
    const result = await channel.request.vfs_mount({ config });
    return result.ok;
  } catch (error) {
    console.error("vfs_mount RPC failed:", error);
    return false;
  }
}

export async function walkVfsChildrenInBun(input: {
  path: string;
  limit: number;
  cursor?: VfsCursor;
}): Promise<{ items: VfsNode[]; nextCursor?: VfsCursor; source: "local" | "remote" } | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.vfs_walk_children(input);
  } catch (error) {
    console.error("vfs_walk_children RPC failed:", error);
    return null;
  }
}

export async function triggerVfsReconcileInBun(mountId: string): Promise<boolean> {
  const channel = await getRpc();
  if (!channel) return false;
  try {
    const result = await channel.request.vfs_trigger_reconcile({ mountId });
    return result.ok;
  } catch (error) {
    console.error("vfs_trigger_reconcile RPC failed:", error);
    return false;
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

export async function listChatSessionsInBun(): Promise<ChatSession[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.chat_list_sessions();
  } catch (error) {
    console.error("chat_list_sessions RPC failed:", error);
    return null;
  }
}

export async function createChatSessionInBun(title?: string): Promise<ChatSession | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.chat_create_session({ title });
  } catch (error) {
    console.error("chat_create_session RPC failed:", error);
    return null;
  }
}

export async function renameChatSessionInBun(sessionId: string, title: string): Promise<boolean> {
  const channel = await getRpc();
  if (!channel) return false;
  try {
    const result = await channel.request.chat_rename_session({ sessionId, title });
    return result.ok;
  } catch (error) {
    console.error("chat_rename_session RPC failed:", error);
    return false;
  }
}

export async function deleteChatSessionInBun(sessionId: string): Promise<boolean> {
  const channel = await getRpc();
  if (!channel) return false;
  try {
    const result = await channel.request.chat_delete_session({ sessionId });
    return result.ok;
  } catch (error) {
    console.error("chat_delete_session RPC failed:", error);
    return false;
  }
}

export async function listChatMessagesInBun(
  sessionId: string,
): Promise<Array<ChatMessage & { citations?: ChatCitation[] }> | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.chat_list_messages({ sessionId });
  } catch (error) {
    console.error("chat_list_messages RPC failed:", error);
    return null;
  }
}

export async function startChatStreamInBun(input: {
  sessionId: string;
  content: string;
  onChunk: (chunk: string) => void;
}): Promise<{ requestId: string; done: Promise<{ message: ChatMessage; citations: ChatCitation[] }> } | null> {
  const channel = await getRpc();
  if (!channel) return null;
  const requestId = globalThis.crypto.randomUUID();
  const done = new Promise<{ message: ChatMessage; citations: ChatCitation[] }>((resolve, reject) => {
    const timeout = setTimeout(() => {
      chatStreamPending.delete(requestId);
      reject(new Error("chat stream timed out"));
    }, 10 * 60 * 1000);
    chatStreamPending.set(requestId, {
      onChunk: input.onChunk,
      resolve,
      reject,
      timeout,
    });
  });
  try {
    await channel.request.chat_send_message_start({
      requestId,
      sessionId: input.sessionId,
      content: input.content,
    });
    return { requestId, done };
  } catch (error) {
    const pending = chatStreamPending.get(requestId);
    if (pending) {
      clearTimeout(pending.timeout);
      chatStreamPending.delete(requestId);
      pending.reject(new Error(String(error)));
    }
    console.error("chat_send_message_start RPC failed:", error);
    return null;
  }
}

export async function stopChatStreamInBun(requestId: string): Promise<boolean> {
  const channel = await getRpc();
  if (!channel) return false;
  try {
    const result = await channel.request.chat_stop_stream({ requestId });
    return result.ok;
  } catch (error) {
    console.error("chat_stop_stream RPC failed:", error);
    return false;
  }
}

export async function fetchOpenAiChatModelsInBun(
  apiKey: string,
  domain: string,
): Promise<string[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    const result = await channel.request.chat_fetch_openai_models({ apiKey, domain });
    return result.models;
  } catch (error) {
    console.error("chat_fetch_openai_models RPC failed:", error);
    return null;
  }
}
