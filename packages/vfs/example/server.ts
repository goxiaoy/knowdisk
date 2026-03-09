import { createVfsExampleApp } from "./app";
import { shouldAutoOpenBrowser, tryOpenBrowser } from "./browser-open";

const app = await createVfsExampleApp({
  port: Number(process.env.VFS_EXAMPLE_PORT ?? "3099"),
});

console.log(`VFS example is running at ${app.baseUrl}`);
if (shouldAutoOpenBrowser(process.stdout?.isTTY)) {
  tryOpenBrowser(app.baseUrl);
}

const shutdown = async () => {
  await app.stop();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
