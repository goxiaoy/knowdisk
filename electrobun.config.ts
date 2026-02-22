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
				"onnxruntime-node",
				"onnxruntime-web",
				"onnxruntime-common",
			],
		},
		// Vite builds to dist/, we copy from there
		copy: {
			"dist/index.html": "views/mainview/index.html",
			"dist/assets": "views/mainview/assets",
			"node_modules/@huggingface/transformers": "node_modules/@huggingface/transformers",
			"node_modules/onnxruntime-node": "node_modules/onnxruntime-node",
			"node_modules/onnxruntime-web": "node_modules/onnxruntime-web",
			"node_modules/onnxruntime-common": "node_modules/onnxruntime-common",
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
