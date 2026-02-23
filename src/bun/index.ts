import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { opendir } from "node:fs/promises";
import { join } from "node:path";
import { watch, type FSWatcher } from "node:fs";
import { statSync } from "node:fs";
import { createAppContainer } from "./app.container";
import type { AppConfig } from "../core/config/config.types";
import { createConfigService } from "../core/config/config.service";
import type { IndexingStatus } from "../core/indexing/indexing.service.types";
import type { RetrievalResult } from "../core/retrieval/retrieval.service.types";
import type { VectorCollectionInspect } from "../core/vector/vector.repository.types";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      container.loggerService.info({ devServerUrl: DEV_SERVER_URL }, "HMR enabled: using Vite dev server");
      return DEV_SERVER_URL;
    } catch {
      container.loggerService.warn("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
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
const fsWatchers: FSWatcher[] = [];
let incrementalFlushTimer: ReturnType<typeof setTimeout> | null = null;
const pendingIncremental = new Map<string, "add" | "change" | "unlink">();
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
if (startupConfig.indexing.watch.enabled) {
  const watchSources = startupConfig.sources
    .filter((source) => source.enabled)
    .map((source) => source.path);
  for (const sourcePath of watchSources) {
    try {
      const watcher = watch(
        sourcePath,
        { recursive: true },
        (_eventType, filename) => {
          if (!filename) {
            return;
          }
          const fullPath = join(sourcePath, String(filename));
          const type = classifyFileChange(fullPath);
          pendingIncremental.set(fullPath, type);
          scheduleIncrementalFlush(startupConfig.indexing.watch.debounceMs);
        },
      );
      fsWatchers.push(watcher);
    } catch (error) {
      container.loggerService.warn(
        { sourcePath, error: String(error) },
        "Failed to start source watcher",
      );
    }
  }
  if (fsWatchers.length > 0) {
    container.loggerService.info(
      { sourceCount: fsWatchers.length, debounceMs: startupConfig.indexing.watch.debounceMs },
      "Index watcher started",
    );
  }
}

const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      get_config() {
        return container.configService.getConfig();
      },
      update_config({ config }: { config: AppConfig }) {
        return container.configService.updateConfig(() => config);
      },
      add_source({ path }: { path: string }) {
        return container.addSourceAndReindex(path);
      },
      update_source({ path, enabled }: { path: string; enabled: boolean }) {
        return container.configService.updateConfig((source) => ({
          ...source,
          sources: source.sources.map((item) =>
            item.path === path ? { ...item, enabled } : item,
          ),
        })).sources;
      },
      remove_source({ path }: { path: string }) {
        return container.configService.updateConfig((source) => ({
          ...source,
          sources: source.sources.filter((item) => item.path !== path),
        })).sources;
      },
      get_health() {
        return container.healthService.getComponentHealth();
      },
      get_index_status(): IndexingStatus {
        return container.indexingService.getIndexStatus().getSnapshot();
      },
      get_vector_stats(): Promise<VectorCollectionInspect> {
        return container.vectorRepository.inspect();
      },
      search_retrieval({ query, topK }: { query: string; topK: number }): Promise<RetrievalResult[]> {
        return container.retrievalService.search(query, { topK });
      },
      retrieve_source_chunks({ sourcePath }: { sourcePath: string }): Promise<RetrievalResult[]> {
        return container.retrievalService.retrieveBySourcePath(sourcePath);
      },
      async list_source_files(): Promise<string[]> {
        const cfg = container.configService.getConfig();
        const sourceDirs = cfg.sources.filter((source) => source.enabled).map((source) => source.path);
        return listFilesFromSourceDirs(sourceDirs, 5000);
      },
      force_resync() {
        return container.forceResync();
      },
      pick_source_directory_start({ requestId }: { requestId: string }) {
        void (async () => {
          try {
            const paths = await Utils.openFileDialog({
              canChooseFiles: false,
              canChooseDirectory: true,
              allowsMultipleSelection: false,
            });
            const [firstPath] = paths;
            rpc.send.pick_source_directory_result({
              requestId,
              path: firstPath ?? null,
            });
          } catch (error) {
            rpc.send.pick_source_directory_result({
              requestId,
              path: null,
              error: String(error),
            });
          }
        })();
        return { ok: true };
      },
      pick_file_path_start({ requestId }: { requestId: string }) {
        void (async () => {
          try {
            const paths = await Utils.openFileDialog({
              canChooseFiles: true,
              canChooseDirectory: false,
              allowsMultipleSelection: false,
            });
            const [firstPath] = paths;
            rpc.send.pick_file_path_result({
              requestId,
              path: firstPath ?? null,
            });
          } catch (error) {
            rpc.send.pick_file_path_result({
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
  if (incrementalFlushTimer) {
    clearTimeout(incrementalFlushTimer);
  }
  for (const watcher of fsWatchers) {
    watcher.close();
  }
  if (reconcileTimer) {
    clearInterval(reconcileTimer);
  }
  mcpHttpServer?.stop(true);
  void container.mcpServer?.close();
  container.close();
  Utils.quit();
});

container.loggerService.info("Know Disk app started");

async function listFilesFromSourceDirs(sourceDirs: string[], maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  for (const dir of sourceDirs) {
    await walkDirectory(dir, files, maxFiles);
    if (files.length >= maxFiles) {
      break;
    }
  }
  return files;
}

async function walkDirectory(dirPath: string, files: string[], maxFiles: number): Promise<void> {
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

function scheduleIncrementalFlush(debounceMs: number) {
  if (incrementalFlushTimer) {
    clearTimeout(incrementalFlushTimer);
  }
  incrementalFlushTimer = setTimeout(() => {
    incrementalFlushTimer = null;
    const changes = Array.from(pendingIncremental.entries()).map(([path, type]) => ({ path, type }));
    pendingIncremental.clear();
    if (changes.length === 0) {
      return;
    }
    void container.indexingService.runIncremental(changes).catch((error) => {
      container.loggerService.error(
        { subsystem: "indexing", error: String(error), changeCount: changes.length },
        "incremental indexing failed",
      );
    });
  }, Math.max(10, debounceMs));
}

function classifyFileChange(path: string): "add" | "change" | "unlink" {
  try {
    statSync(path);
    return "change";
  } catch {
    return "unlink";
  }
}
