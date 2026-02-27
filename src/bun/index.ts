import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { opendir } from "node:fs/promises";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { dirname } from "node:path";
import chokidar, { type FSWatcher } from "chokidar";
import { createAppContainer } from "./app.container";
import {
  pickClaudeDesktopConfigPath,
  upsertKnowDiskMcpServerConfig,
} from "./claude-desktop-config";
import { createIncrementalBatcher } from "./incremental-batcher";
import { shouldTriggerModelDownload } from "./model-download-trigger";
import type { AppConfig } from "../core/config/config.types";
import { createConfigService } from "../core/config/config.service";
import type { IndexingStatus } from "../core/indexing/indexing.service.types";
import type { ModelDownloadStatus } from "../core/model/model-download.service.types";
import type { RetrievalDebugResult } from "../core/retrieval/retrieval.service.types";
import type { RetrievalResult } from "../core/retrieval/retrieval.service.types";
import type { VectorCollectionInspect } from "../core/vector/vector.repository.types";
import type { ChatCitation, ChatMessage, ChatSession } from "../core/chat/chat.repository.types";
import type { VfsCursor, VfsMountConfig, VfsNode } from "@knowdisk/vfs";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      container.loggerService.info(
        { devServerUrl: DEV_SERVER_URL },
        "HMR enabled: using Vite dev server",
      );
      return DEV_SERVER_URL;
    } catch {
      container.loggerService.warn(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
      );
    }
  }
  return "views://mainview/index.html";
}

const userDataDir = join(Utils.paths.home, ".knowdisk");
const configService = createConfigService({ userDataDir });
const container = createAppContainer({ configService, userDataDir });
container.loggerService.info(
  { config: container.configService.getConfig() },
  "App startup config",
);
const startupConfig = container.configService.getConfig();
let mcpHttpServer: ReturnType<typeof Bun.serve> | null = null;
let reconcileTimer: ReturnType<typeof setInterval> | null = null;
const sourceWatchers = new Map<string, FSWatcher>();
const runningChatStreams = new Map<string, { stop: boolean }>();
const incrementalBatcher = createIncrementalBatcher({
  debounceMs: startupConfig.indexing.watch.debounceMs,
  runIncremental(changes) {
    return container.indexingService.runIncremental(changes);
  },
  onError(error, changes) {
    container.loggerService.error(
      {
        subsystem: "indexing",
        error: String(error),
        changeCount: changes.length,
      },
      "incremental indexing failed",
    );
  },
});
const stopConfigSubscription = container.configService.subscribe(({ prev, next }) => {
  syncSourceWatchers(next);
  if (next.onboarding.completed && hasEmbeddingChanged(prev, next)) {
    void container.indexingService.runFullRebuild("embedding_changed").catch((error) => {
      container.loggerService.error(
        { subsystem: "indexing", error: String(error) },
        "embedding change reindex failed",
      );
    });
  }
  if (shouldTriggerModelDownload(prev, next)) {
    void container.modelDownloadService
      .ensureRequiredModels()
      .catch((error) => {
        container.loggerService.error(
          { subsystem: "models", error: String(error) },
          "model download trigger failed",
        );
      });
  }
});

const startupCleanup = await container.indexingService
  .purgeDeferredSourceDeletions()
  .catch((error) => {
    container.loggerService.error(
      { subsystem: "indexing", error: String(error) },
      "startup source cleanup failed",
    );
    return null;
  });
if (startupCleanup && startupCleanup.removedSources > 0) {
  container.loggerService.info(
    startupCleanup,
    "startup source cleanup finished",
  );
}
if (startupConfig.mcp.enabled && container.mcpServer) {
  try {
    mcpHttpServer = Bun.serve({
      port: startupConfig.mcp.port,
      async fetch(request: Request) {
        const url = new URL(request.url);
        if (url.pathname !== "/mcp") {
          return new Response("Not Found", { status: 404 });
        }
        return container.mcpServer!.handleHttpRequest(request);
      },
    });
    container.loggerService.info(
      { endpoint: `http://127.0.0.1:${startupConfig.mcp.port}/mcp` },
      "MCP HTTP endpoint exposed",
    );
  } catch (error) {
    container.loggerService.error(
      { port: startupConfig.mcp.port, error: String(error) },
      "Failed to start MCP HTTP endpoint",
    );
  }
}
if (startupConfig.indexing.reconcile.enabled) {
  void container.indexingService
    .runScheduledReconcile()
    .then((report) => {
      container.loggerService.info(
        { repaired: report.repaired },
        "Startup reconcile completed",
      );
    })
    .catch((error) => {
      container.loggerService.error(
        { subsystem: "indexing", error: String(error) },
        "startup reconcile failed",
      );
    });

  reconcileTimer = setInterval(() => {
    void container.indexingService.runScheduledReconcile().catch((error) => {
      container.loggerService.error(
        { subsystem: "indexing", error: String(error) },
        "scheduled reconcile failed",
      );
    });
  }, startupConfig.indexing.reconcile.intervalMs);
  container.loggerService.info(
    { intervalMs: startupConfig.indexing.reconcile.intervalMs },
    "Index reconcile scheduler started",
  );
}
syncSourceWatchers(startupConfig);
void container.modelDownloadService
  .ensureRequiredModels()
  .catch((error) => {
    container.loggerService.error(
      { subsystem: "models", error: String(error) },
      "startup model download failed",
    );
  });

const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      get_config() {
        return container.configService.getConfig();
      },
      update_config(params?: unknown) {
        const { config } = params as { config: AppConfig };
        return container.configService.updateConfig(() => config);
      },
      async add_source(params?: unknown) {
        const { path } = params as { path: string };
        const next = container.configService.updateConfig((source) => {
          if (source.sources.some((item) => item.path === path)) {
            return source;
          }
          return {
            ...source,
            sources: [...source.sources, { path, enabled: true }],
          };
        });
        container.indexingService.cancelDeferredSourceDeletion(path);
        void container.indexingService.runFullRebuild("source_added");
        return next.sources;
      },
      update_source(params?: unknown) {
        const { path, enabled } = params as { path: string; enabled: boolean };
        const next = container.configService.updateConfig((source) => ({
          ...source,
          sources: source.sources.map((item) =>
            item.path === path ? { ...item, enabled } : item,
          ),
        }));
        if (enabled) {
          container.indexingService.cancelDeferredSourceDeletion(path);
          void container.indexingService.runFullRebuild("source_enabled");
        } else {
          container.indexingService.deferSourceDeletion(path);
        }
        return next.sources;
      },
      remove_source(params?: unknown) {
        const { path } = params as { path: string };
        const next = container.configService.updateConfig((source) => ({
          ...source,
          sources: source.sources.filter((item) => item.path !== path),
        }));
        container.indexingService.deferSourceDeletion(path);
        return next.sources;
      },
      get_index_status(): IndexingStatus {
        const snapshot = container.indexingService
          .getIndexStatus()
          .getSnapshot();
        return {
          ...snapshot,
          run: {
            ...snapshot.run,
            indexedFiles: container.indexingService.getIndexedFilesCount(),
          },
        };
      },
      get_vector_stats(): Promise<VectorCollectionInspect> {
        return container.vectorRepository.inspect();
      },
      get_model_download_status(): ModelDownloadStatus {
        return container.modelDownloadService.getStatus().getSnapshot();
      },
      retry_model_download(): Promise<{ ok: boolean }> {
        return container.modelDownloadService.retryNow();
      },
      redownload_model_download(params?: unknown): Promise<{ ok: boolean }> {
        const { taskId } = params as { taskId: "embedding-local" | "reranker-local" };
        return container.modelDownloadService.redownloadModel(taskId);
      },
      search_retrieval(params?: unknown): Promise<RetrievalDebugResult> {
        const { query, topK, titleOnly } = params as {
          query: string;
          topK: number;
          titleOnly?: boolean;
        };
        return container.retrievalService.search(query, { topK, titleOnly });
      },
      retrieve_source_chunks(params?: unknown): Promise<RetrievalResult[]> {
        const { sourcePath } = params as { sourcePath: string };
        return container.retrievalService.retrieveBySourcePath(sourcePath, true);
      },
      async list_source_files(): Promise<string[]> {
        const cfg = container.configService.getConfig();
        const sourceDirs = cfg.sources
          .filter((source) => source.enabled)
          .map((source) => source.path);
        return listFilesFromSourceDirs(sourceDirs, 5000);
      },
      async force_resync() {
        try {
          await container.vectorRepository.destroy();
          container.indexingService.clearAllIndexData();
          await container.indexingService.runFullRebuild("force_resync");
          return { ok: true };
        } catch (error) {
          container.loggerService.error(
            { subsystem: "indexing", error: String(error) },
            "force resync failed",
          );
          return { ok: false, error: String(error) };
        }
      },
      async vfs_mount(params?: unknown) {
        const { config } = params as { config: VfsMountConfig };
        await container.vfsService.mount(config);
        return { ok: true };
      },
      vfs_walk_children(params?: unknown): Promise<{
        items: VfsNode[];
        nextCursor?: VfsCursor;
        source: "local" | "remote";
      }> {
        const { path, limit, cursor } = params as {
          path: string;
          limit: number;
          cursor?: VfsCursor;
        };
        return container.vfsService.walkChildren({ path, limit, cursor });
      },
      vfs_read_markdown(params?: unknown): Promise<{ node: VfsNode; markdown: string }> {
        const { path } = params as { path: string };
        return container.vfsService.readMarkdown(path);
      },
      async vfs_trigger_reconcile(params?: unknown) {
        const { mountId } = params as { mountId: string };
        await container.vfsService.triggerReconcile(mountId);
        return { ok: true };
      },
      chat_list_sessions(): ChatSession[] {
        return container.chatService.listSessions();
      },
      chat_create_session(params?: unknown): ChatSession {
        const { title } = (params as { title?: string } | undefined) ?? {};
        return container.chatService.createSession({ title });
      },
      chat_rename_session(params?: unknown): { ok: boolean } {
        const { sessionId, title } = params as { sessionId: string; title: string };
        container.chatService.renameSession(sessionId, title);
        return { ok: true };
      },
      chat_delete_session(params?: unknown): { ok: boolean } {
        const { sessionId } = params as { sessionId: string };
        container.chatService.deleteSession(sessionId);
        return { ok: true };
      },
      chat_list_messages(params?: unknown): Array<ChatMessage & { citations?: ChatCitation[] }> {
        const { sessionId } = params as { sessionId: string };
        return container.chatService.listMessages(sessionId);
      },
      chat_send_message_start(params?: unknown): { ok: boolean } {
        const { requestId, sessionId, content } = params as {
          requestId: string;
          sessionId: string;
          content: string;
        };
        const handle = { stop: false };
        runningChatStreams.set(requestId, handle);
        void container.chatService
          .sendMessage(
            {
              sessionId,
              content,
              shouldStop: () => handle.stop,
            },
            (event) => {
              (rpc.send as any).chat_stream_event({
                requestId,
                event,
              });
            },
          )
          .finally(() => {
            runningChatStreams.delete(requestId);
          });
        return { ok: true };
      },
      chat_stop_stream(params?: unknown): { ok: boolean } {
        const { requestId } = params as { requestId: string };
        const stream = runningChatStreams.get(requestId);
        if (stream) {
          stream.stop = true;
        }
        return { ok: true };
      },
      async chat_fetch_openai_models(params?: unknown): Promise<{ models: string[] }> {
        const { apiKey, domain } = params as { apiKey: string; domain: string };
        const base = normalizeOpenAiDomain(domain);
        const endpoint = new URL("/v1/models", `${base}/`).toString();
        const response = await fetch(endpoint, {
          method: "GET",
          headers: {
            authorization: `Bearer ${apiKey}`,
          },
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`openai_models_fetch_failed_${response.status}:${detail}`);
        }
        const payload = (await response.json()) as {
          data?: Array<{ id?: string; created?: number }>;
        };
        const models = (payload.data ?? [])
          .filter((row) => typeof row.id === "string" && row.id.length > 0)
          .map((row) => ({
            id: row.id!,
            created: typeof row.created === "number" ? row.created : 0,
          }))
          .filter((row) => row.id.startsWith("gpt-"))
          .sort((a, b) => b.created - a.created || a.id.localeCompare(b.id))
          .map((row) => row.id);
        return { models };
      },
      async install_claude_mcp() {
        try {
          const cfg = container.configService.getConfig();
          const endpoint = `http://127.0.0.1:${cfg.mcp.port}/mcp`;
          const configPath = pickClaudeDesktopConfigPath({
            homeDir: Utils.paths.home,
            platform: process.platform,
          });
          let raw = "{}";
          try {
            raw = await readFile(configPath, "utf8");
          } catch {
            raw = "{}";
          }
          const next = upsertKnowDiskMcpServerConfig(raw, { endpoint });
          await mkdir(dirname(configPath), { recursive: true });
          await writeFile(
            configPath,
            `${JSON.stringify(next, null, 2)}\n`,
            "utf8",
          );
          container.loggerService.info(
            { subsystem: "mcp", endpoint, configPath },
            "Claude Desktop MCP config updated",
          );
          return { ok: true, path: configPath };
        } catch (error) {
          container.loggerService.error(
            { subsystem: "mcp", error: String(error) },
            "Failed to update Claude Desktop MCP config",
          );
          return { ok: false, error: String(error) };
        }
      },
      pick_source_directory_start(params?: unknown) {
        const { requestId } = params as { requestId: string };
        void (async () => {
          try {
            const paths = await Utils.openFileDialog({
              canChooseFiles: false,
              canChooseDirectory: true,
              allowsMultipleSelection: false,
            });
            const [firstPath] = paths;
            (rpc.send as any).pick_source_directory_result({
              requestId,
              path: firstPath ?? null,
            });
          } catch (error) {
            (rpc.send as any).pick_source_directory_result({
              requestId,
              path: null,
              error: String(error),
            });
          }
        })();
        return { ok: true };
      },
      pick_file_path_start(params?: unknown) {
        const { requestId } = params as { requestId: string };
        void (async () => {
          try {
            const paths = await Utils.openFileDialog({
              canChooseFiles: true,
              canChooseDirectory: false,
              allowsMultipleSelection: false,
            });
            const [firstPath] = paths;
            (rpc.send as any).pick_file_path_result({
              requestId,
              path: firstPath ?? null,
            });
          } catch (error) {
            (rpc.send as any).pick_file_path_result({
              requestId,
              path: null,
              error: String(error),
            });
          }
        })();
        return { ok: true };
      },
    },
    messages: {},
  },
});

const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
  title: "Know Disk",
  url,
  rpc,
  frame: {
    width: 900,
    height: 700,
    x: 200,
    y: 200,
  },
});

mainWindow.on("close", () => {
  incrementalBatcher.dispose();
  for (const watcher of sourceWatchers.values()) {
    void watcher.close();
  }
  sourceWatchers.clear();
  stopConfigSubscription();
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
  }
  mcpHttpServer?.stop(true);
  void container.mcpServer?.close();
  container.close();
  Utils.quit();
});

container.loggerService.info("Know Disk app started");

async function listFilesFromSourceDirs(
  sourceDirs: string[],
  maxFiles: number,
): Promise<string[]> {
  const files: string[] = [];
  for (const dir of sourceDirs) {
    await walkDirectory(dir, files, maxFiles);
    if (files.length >= maxFiles) {
      break;
    }
  }
  return files;
}

async function walkDirectory(
  dirPath: string,
  files: string[],
  maxFiles: number,
): Promise<void> {
  if (files.length >= maxFiles) {
    return;
  }
  let dir;
  try {
    dir = await opendir(dirPath);
  } catch {
    return;
  }
  for await (const entry of dir) {
    if (files.length >= maxFiles) {
      break;
    }
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      await walkDirectory(fullPath, files, maxFiles);
      continue;
    }
    if (entry.isFile()) {
      files.push(fullPath);
    }
  }
}

function syncSourceWatchers(config: AppConfig) {
  if (!config.indexing.watch.enabled) {
    for (const [sourcePath, watcher] of sourceWatchers.entries()) {
      void watcher.close();
      sourceWatchers.delete(sourcePath);
    }
    return;
  }

  const nextWatchSources = new Set(
    config.sources
      .filter((source) => source.enabled)
      .map((source) => source.path),
  );

  for (const [sourcePath, watcher] of sourceWatchers.entries()) {
    if (nextWatchSources.has(sourcePath)) {
      continue;
    }
    void watcher.close();
    sourceWatchers.delete(sourcePath);
    container.loggerService.info({ sourcePath }, "Source watcher stopped");
  }

  for (const sourcePath of nextWatchSources) {
    if (sourceWatchers.has(sourcePath)) {
      continue;
    }
    try {
      const watcher = chokidar.watch(sourcePath, {
        ignoreInitial: true,
        awaitWriteFinish: {
          stabilityThreshold: 300,
          pollInterval: 100,
        },
      });
      watcher.on("add", (path) => {
        incrementalBatcher.enqueue(path, "add");
      });
      watcher.on("change", (path) => {
        incrementalBatcher.enqueue(path, "change");
      });
      watcher.on("unlink", (path) => {
        incrementalBatcher.enqueue(path, "unlink");
      });
      watcher.on("error", (error) => {
        container.loggerService.warn(
          { sourcePath, error: String(error) },
          "Source watcher error",
        );
      });
      sourceWatchers.set(sourcePath, watcher);
      container.loggerService.info({ sourcePath }, "Source watcher started");
    } catch (error) {
      container.loggerService.warn(
        { sourcePath, error: String(error) },
        "Failed to start source watcher",
      );
    }
  }
}

function hasEmbeddingChanged(prev: AppConfig, next: AppConfig): boolean {
  if (prev.embedding.provider !== next.embedding.provider) {
    return true;
  }
  const provider = next.embedding.provider;
  if (provider === "local") {
    return (
      prev.embedding.local.model !== next.embedding.local.model ||
      prev.embedding.local.dimension !== next.embedding.local.dimension
    );
  }
  return (
    prev.embedding[provider].model !== next.embedding[provider].model ||
    prev.embedding[provider].dimension !== next.embedding[provider].dimension
  );
}

function normalizeOpenAiDomain(domain: string): string {
  const value = domain.trim().replace(/\/+$/, "");
  const parsed = new URL(value);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("invalid_openai_domain_protocol");
  }
  return value;
}
