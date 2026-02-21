import { BrowserView, BrowserWindow, Updater, Utils } from "electrobun/bun";
import { defaultConfigService } from "../core/config/config.service";
import { createHealthService } from "../core/health/health.service";
import { createMcpServer } from "../core/mcp/mcp.server";

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

function bootstrapMcp() {
  if (!defaultConfigService.getMcpEnabled()) {
    console.log("MCP server disabled in settings.");
    return null;
  }

  return createMcpServer({
    retrieval: {
      async search() {
        return [];
      },
    },
    isEnabled: () => defaultConfigService.getMcpEnabled(),
  });
}

bootstrapMcp();

const rpc = BrowserView.defineRPC({
  handlers: {
    requests: {
      get_config() {
        return defaultConfigService.getConfig();
      },
      set_mcp_enabled({ enabled }: { enabled: boolean }) {
        return defaultConfigService.setMcpEnabled(enabled);
      },
      add_source({ path }: { path: string }) {
        return defaultConfigService.addSource(path);
      },
      update_source({ path, enabled }: { path: string; enabled: boolean }) {
        return defaultConfigService.updateSource(path, enabled);
      },
      remove_source({ path }: { path: string }) {
        return defaultConfigService.removeSource(path);
      },
      get_health() {
        return createHealthService().getComponentHealth();
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
