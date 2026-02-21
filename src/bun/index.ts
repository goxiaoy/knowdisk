import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { join } from "node:path";
import { createAppContainer } from "./app.container";
import { downloadModelFromHub } from "../core/model/model-download.service";
import type { AppConfig } from "../core/config/config.types";
import { createConfigService } from "../core/config/config.service";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log("Vite dev server not running. Run 'bun run dev:hmr' for HMR support.");
    }
  }
  return "views://mainview/index.html";
}

const userDataDir = Utils.paths.userData;
const configService = createConfigService({ userDataDir });
const container = createAppContainer({ configService, userDataDir });
const startupConfig = container.configService.getConfig();
console.log("App startup config:", JSON.stringify(startupConfig, null, 2));

if (!container.mcpServer) {
  console.log("MCP server disabled in settings.");
}

function maybeDownloadEmbeddingModel(config: AppConfig) {
  if (config.embedding.provider !== "local") {
    return;
  }
  void downloadModelFromHub({
    hfEndpoint: config.embedding.local.hfEndpoint,
    model: config.embedding.local.model,
    targetRoot: join(userDataDir, "models", "embedding", "provider-local"),
  }).catch((error) => {
    console.error(`Embedding model download failed for ${config.embedding.local.model}:`, error);
  });
}

function maybeDownloadRerankerModel(config: AppConfig) {
  if (!config.reranker.enabled || config.reranker.provider !== "local") {
    return;
  }
  void downloadModelFromHub({
    hfEndpoint: config.reranker.local.hfEndpoint,
    model: config.reranker.local.model,
    targetRoot: join(userDataDir, "models", "reranker", "provider-local"),
  }).catch((error) => {
    console.error(`Reranker model download failed for ${config.reranker.local.model}:`, error);
  });
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
      set_mcp_enabled({ enabled }: { enabled: boolean }) {
        return container.configService.updateConfig((source) => ({
          ...source,
          mcp: { enabled },
        }));
      },
      set_embedding_config(input: Partial<AppConfig["embedding"]>) {
        const updated = container.configService.updateConfig((source) => ({
          ...source,
          embedding: {
            ...source.embedding,
            ...input,
            local: {
              ...source.embedding.local,
              ...(input.local ?? {}),
            },
            qwen_dense: {
              ...source.embedding.qwen_dense,
              ...(input.qwen_dense ?? {}),
            },
            qwen_sparse: {
              ...source.embedding.qwen_sparse,
              ...(input.qwen_sparse ?? {}),
            },
            openai_dense: {
              ...source.embedding.openai_dense,
              ...(input.openai_dense ?? {}),
            },
          },
        }));
        maybeDownloadEmbeddingModel(updated);
        return updated;
      },
      set_reranker_config(input: Partial<AppConfig["reranker"]>) {
        const updated = container.configService.updateConfig((source) => ({
          ...source,
          reranker: {
            ...source.reranker,
            ...input,
            local: {
              ...source.reranker.local,
              ...(input.local ?? {}),
            },
            qwen: {
              ...source.reranker.qwen,
              ...(input.qwen ?? {}),
            },
            openai: {
              ...source.reranker.openai,
              ...(input.openai ?? {}),
            },
          },
        }));
        maybeDownloadRerankerModel(updated);
        return updated;
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
      async pick_source_directory() {
        const paths = await Utils.openFileDialog({
          canChooseFiles: false,
          canChooseDirectory: true,
          allowsMultipleSelection: false,
        });
        return paths[0] ?? null;
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
  Utils.quit();
});

console.log("Know Disk app started!");
