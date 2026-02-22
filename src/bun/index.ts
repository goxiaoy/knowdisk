import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { join } from "node:path";
import { createAppContainer } from "./app.container";
import type { AppConfig } from "../core/config/config.types";
import { createConfigService } from "../core/config/config.service";
import type { IndexingStatus } from "../core/indexing/indexing.service.types";
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
      force_resync() {
        return container.forceResync();
      },
      pick_source_directory_start() {
        const requestId = globalThis.crypto.randomUUID();
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
        return { requestId };
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
  mcpHttpServer?.stop(true);
  void container.mcpServer?.close();
  Utils.quit();
});

container.loggerService.info("Know Disk app started");
