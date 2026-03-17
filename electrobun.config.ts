import type { ElectrobunConfig } from "electrobun";

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
    copy: {
      "dist/index.html": "views/app/index.html",
      "dist/assets": "views/app/assets",
      "vendor/python-runtime": "python-runtime",
      "vendor/python-worker": "python-worker",
      "vendor/node_modules/sharp": "node_modules/sharp",
      "vendor/node_modules/@img": "node_modules/@img",
    },
    mac: {
      bundleCEF: false,
    },
    linux: {
      bundleCEF: false,
    },
    win: {
      bundleCEF: false,
    },
  },
} satisfies ElectrobunConfig;
