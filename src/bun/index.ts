import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { createAppContainer } from "./app.container";
import { downloadModelFromHub } from "../core/model/model-download.service";
import { getEmbeddingProviderModel } from "../core/embedding/embedding.types";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;

// Check if Vite dev server is running for HMR
async function getMainViewUrl(): Promise<string> {
  const channel = await Updater.localInfo.channel();
  if (channel === "dev") {
    try {
      await fetch(DEV_SERVER_URL, { method: "HEAD" });
      console.log(`HMR enabled: Using Vite dev server at ${DEV_SERVER_URL}`);
      return DEV_SERVER_URL;
    } catch {
      console.log(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
      );
    }
  }
  return "views://mainview/index.html";
}

const container = createAppContainer();
const startupConfig = container.configService.getConfig();
console.log("App startup config:", JSON.stringify(startupConfig, null, 2));

if (!container.mcpServer) {
  console.log("MCP server disabled in settings.");
}

const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      get_config() {
        return container.configService.getConfig();
      },
      set_mcp_enabled({ enabled }: { enabled: boolean }) {
        return container.configService.setMcpEnabled(enabled);
      },
      set_embedding_config({
        provider,
        endpoint,
        apiKeys,
        dimension,
      }: {
        provider?: "local" | "qwen_dense" | "qwen_sparse" | "openai_dense";
        endpoint?: string;
        apiKeys?: Record<string, string>;
        dimension?: number;
      }) {
        const updated = container.configService.updateEmbedding({
          provider,
          endpoint,
          apiKeys,
          dimension,
        });
        if ((provider ?? updated.embedding.provider) === "local") {
          const localModel = getEmbeddingProviderModel("local");
          void downloadModelFromHub({
            hfEndpoint: updated.modelHub.hfEndpoint,
            model: localModel,
            targetRoot: "build/models",
          }).catch((error) => {
            console.error(`Model download failed for ${localModel}:`, error);
          });
        }
        return updated;
      },
      set_model_hub_config({ hfEndpoint }: { hfEndpoint?: string }) {
        return container.configService.updateModelHub({ hfEndpoint });
      },
      set_reranker_config({
        mode,
        model,
        topN,
      }: {
        mode?: "none" | "local";
        model?: string;
        topN?: number;
      }) {
        const updated = container.configService.updateReranker({ mode, model, topN });
        if (model) {
          void downloadModelFromHub({
            hfEndpoint: updated.modelHub.hfEndpoint,
            model,
            targetRoot: "build/models",
          }).catch((error) => {
            console.error(`Model download failed for ${model}:`, error);
          });
        }
        return updated;
      },
      add_source({ path }: { path: string }) {
        return container.addSourceAndReindex(path);
      },
      update_source({ path, enabled }: { path: string; enabled: boolean }) {
        return container.configService.updateSource(path, enabled);
      },
      remove_source({ path }: { path: string }) {
        return container.configService.removeSource(path);
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

// Create the main application window
const url = await getMainViewUrl();

const mainWindow = new BrowserWindow({
  title: "React + Tailwind + Vite",
  url,
  rpc,
  frame: {
    width: 900,
    height: 700,
    x: 200,
    y: 200,
  },
});

// Quit the app when the main window is closed
mainWindow.on("close", () => {
  Utils.quit();
});

console.log("React Tailwind Vite app started!");
