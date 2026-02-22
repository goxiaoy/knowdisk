import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { join } from "node:path";
import { createAppContainer } from "./app.container";
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
      console.log(
        "Vite dev server not running. Run 'bun run dev:hmr' for HMR support.",
      );
    }
  }
  return "views://mainview/index.html";
}

const userDataDir = join(Utils.paths.home, ".knowdisk");
const configService = createConfigService({ userDataDir });
const container = createAppContainer({ configService, userDataDir });
console.log(
  "App startup config:",
  JSON.stringify(container.configService.getConfig(), null, 2),
);

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
  Utils.quit();
});

console.log("Know Disk app started!");
