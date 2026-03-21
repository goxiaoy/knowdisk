import { existsSync as defaultExistsSync } from "node:fs";
import type { ElectrobunConfig } from "electrobun";

type BuildCopyConfig = Record<string, string>;

export function createBuildCopyConfig(input?: {
  existsSync?: (path: string) => boolean;
}): BuildCopyConfig {
  const existsSync = input?.existsSync ?? defaultExistsSync;
  const copy: BuildCopyConfig = {
    "dist/index.html": "views/app/index.html",
    "dist/assets": "views/app/assets",
    "vendor/node_modules/sharp": "node_modules/sharp",
    "vendor/node_modules/@img": "node_modules/@img",
  };

  if (existsSync("vendor/python-sidecar")) {
    copy["vendor/python-sidecar"] = "python-sidecar";
  }

  return copy;
}

export const defaultBuildCopyConfig = createBuildCopyConfig();

export default {
  app: {
    name: "Know Disk",
    identifier: "knowdisk.electrobun.dev",
    version: "0.0.1",
  },
  build: {
    bun: {
      external: [
      ],
    },
    // Vite builds to dist/, we copy from there
    copy: defaultBuildCopyConfig,
    mac: {
      bundleCEF: false,
      icons: "assets/icon/icon.iconset",
    },
    linux: {
      bundleCEF: false,
      icon: "assets/icon/app-icon.png",
    },
    win: {
      bundleCEF: false,
      icon: "assets/icon/app-icon.png",
    },
  },
} satisfies ElectrobunConfig;
