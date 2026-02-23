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
const sourceWatchers = new Map<string, FSWatcher>();
const incrementalBatcher = createIncrementalBatcher({
  debounceMs: startupConfig.indexing.watch.debounceMs,
  runIncremental(changes) {
    return container.indexingService.runIncremental(changes);
  },
  onError(error, changes) {
    container.loggerService.error(
      { subsystem: "indexing", error: String(error), changeCount: changes.length },
      "incremental indexing failed",
    );
  },
});
const stopConfigSubscription = container.configService.subscribe(({ next }) => {
  syncSourceWatchers(next);
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
  void container.indexingService.runScheduledReconcile().then((report) => {
    container.loggerService.info(
      { repaired: report.repaired },
      "Startup reconcile completed",
    );
  }).catch((error) => {
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
      get_health() {
        return container.healthService.getComponentHealth();
      },
      get_index_status(): IndexingStatus {
        const snapshot = container.indexingService.getIndexStatus().getSnapshot();
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
      search_retrieval(
        params?: unknown,
      ): Promise<RetrievalResult[]> {
        const { query, topK, titleOnly } = params as {
          query: string;
          topK: number;
          titleOnly?: boolean;
        };
        return container.retrievalService.search(query, { topK, titleOnly });
      },
      retrieve_source_chunks(params?: unknown): Promise<RetrievalResult[]> {
        const { sourcePath } = params as { sourcePath: string };
        return container.retrievalService.retrieveBySourcePath(sourcePath);
      },
      async list_source_files(): Promise<string[]> {
        const cfg = container.configService.getConfig();
        const sourceDirs = cfg.sources.filter((source) => source.enabled).map((source) => source.path);
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
          await writeFile(configPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
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

function syncSourceWatchers(config: AppConfig) {
  if (!config.indexing.watch.enabled) {
    for (const [sourcePath, watcher] of sourceWatchers.entries()) {
      void watcher.close();
      sourceWatchers.delete(sourcePath);
    }
    return;
  }

  const nextWatchSources = new Set(
    config.sources.filter((source) => source.enabled).map((source) => source.path),
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
