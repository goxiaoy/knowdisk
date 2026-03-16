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
        "@huggingface/transformers",
        // "onnxruntime-node",
        // "onnxruntime-web",
        // "onnxruntime-common",
      ],
    },
    // Vite builds to dist/, we copy from there
    copy: {
      "dist/index.html": "views/app/index.html",
      "dist/assets": "views/app/assets",
      "node_modules/@huggingface/transformers": "node_modules/@huggingface/transformers",
      "vendor/node_modules/@zvec/bindings-darwin-arm64": "node_modules/@zvec/bindings-darwin-arm64",
      "vendor/node_modules/onnxruntime-common": "node_modules/onnxruntime-common",
      "vendor/node_modules/onnxruntime-node": "node_modules/onnxruntime-node",
      "vendor/node_modules/onnxruntime-web": "node_modules/onnxruntime-web",
      "vendor/node_modules/sharp": "node_modules/sharp",
      "vendor/node_modules/detect-libc": "node_modules/detect-libc",
      "vendor/node_modules/semver": "node_modules/semver",
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
