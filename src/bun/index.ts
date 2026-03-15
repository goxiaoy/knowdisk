import { BrowserWindow, Utils } from "electrobun/bun";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const PROD_VIEW_URL = "views://app/index.html";

// Create the main application window
const mainWindow = new BrowserWindow({
  title: "Hello Electrobun!",
  url:
    process.env.ELECTROBUN_RENDERER_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? DEV_SERVER_URL : PROD_VIEW_URL),
  frame: {
    width: 800,
    height: 800,
    x: 200,
    y: 200,
  },
});

// Quit the app when the main window is closed
mainWindow.on("close", () => {
  Utils.quit();
});
