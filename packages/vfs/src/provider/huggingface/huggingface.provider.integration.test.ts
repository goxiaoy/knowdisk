import { describe, expect, test } from "bun:test";
import { createWriteStream, mkdtempSync, rmSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { VfsMount } from "../../vfs.types";
import { createHuggingFaceVfsProvider } from "./index";

const TEST_MODEL = "hf-internal-testing/tiny-random-bert";

function makeMount(providerExtra: Record<string, unknown>): VfsMount {
  return {
    mountId: "hf-e2e",
    mountPath: "/models/hf",
    providerType: "huggingface",
    providerExtra,
    syncMetadata: false,
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
  };
}

type DownloadFile = {
  sourceRef: string;
  size?: number;
};

async function collectAllFiles(
  provider: ReturnType<typeof createHuggingFaceVfsProvider>,
  mount: VfsMount,
  parentSourceRef: string | null = null,
): Promise<DownloadFile[]> {
  const files: DownloadFile[] = [];
  let cursor: string | undefined;
  do {
    const page = await provider.listChildren({
      mount,
      parentSourceRef,
      limit: 200,
      cursor,
    });
    for (const item of page.items) {
      if (item.kind === "file") {
        files.push({ sourceRef: item.sourceRef, size: item.size });
      } else {
        files.push(...(await collectAllFiles(provider, mount, item.sourceRef)));
      }
    }
    cursor = page.nextCursor;
  } while (cursor);
  return files;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(value >= 10 || index === 0 ? 0 : 1)} ${units[index]}`;
}

async function downloadFileWithProgress(input: {
  provider: ReturnType<typeof createHuggingFaceVfsProvider>;
  mount: VfsMount;
  sourceRef: string;
  outputPath: string;
  expectedSize?: number;
}) {
  const stream = await input.provider.createReadStream!({
    mount: input.mount,
    sourceRef: input.sourceRef,
  });
  const writer = createWriteStream(input.outputPath, { flags: "w" });
  const reader = stream.getReader();
  let loaded = 0;
  let nextLogAt = 5 * 1024 * 1024;
  const total = input.expectedSize ?? 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.length === 0) {
        continue;
      }
      loaded += value.length;
      await new Promise<void>((resolve, reject) => {
        writer.write(Buffer.from(value), (error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
      if (loaded >= nextLogAt) {
        if (total > 0) {
          const pct = ((loaded / total) * 100).toFixed(1);
          console.log(
            `[hf-vfs] downloading ${input.sourceRef}: ${formatBytes(loaded)}/${formatBytes(total)} (${pct}%)`,
          );
        } else {
          console.log(`[hf-vfs] downloading ${input.sourceRef}: ${formatBytes(loaded)}`);
        }
        nextLogAt += 5 * 1024 * 1024;
      }
    }
  } finally {
    await new Promise<void>((resolve, reject) => {
      writer.end((error: Error | null | undefined) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

describe("huggingface vfs provider integration", () => {
  test(
    "downloads model files via vfs and runs transformers.js feature extraction",
    async () => {
      const mount = makeMount({
        model: TEST_MODEL,
      });
      const provider = createHuggingFaceVfsProvider(mount);

      const files = await collectAllFiles(provider, mount);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((file) => file.sourceRef === "onnx/model.onnx")).toBe(true);

      const localModelRoot = mkdtempSync(join(tmpdir(), "knowdisk-vfs-hf-model-"));
      console.log(`[hf-vfs] model cache dir: ${localModelRoot}`);
      console.log(`[hf-vfs] files to download: ${files.length}`);
      try {
        for (let i = 0; i < files.length; i += 1) {
          const file = files[i]!;
          const outputPath = join(localModelRoot, TEST_MODEL, file.sourceRef);
          await mkdir(dirname(outputPath), { recursive: true });
          console.log(
            `[hf-vfs] [${i + 1}/${files.length}] start ${file.sourceRef}` +
              (file.size ? ` (${formatBytes(file.size)})` : ""),
          );
          await downloadFileWithProgress({
            provider,
            mount,
            sourceRef: file.sourceRef,
            outputPath,
            expectedSize: file.size,
          });
          console.log(`[hf-vfs] [${i + 1}/${files.length}] done ${file.sourceRef}`);
        }

        const transformers = await import("@huggingface/transformers");
        const env = (transformers as unknown as { env?: Record<string, unknown> }).env;
        if (env) {
          env.allowRemoteModels = false;
          env.remoteHost = "https://huggingface.co/";
          env.localModelPath = localModelRoot;
          env.cacheDir = localModelRoot;
        }
        console.log(
          `[hf-vfs] transformers env set: localModelPath=${localModelRoot}, allowRemoteModels=false`,
        );

        const { pipeline } = transformers as unknown as {
          pipeline: (
            task: "feature-extraction",
            model: string,
            options?: { local_files_only?: boolean },
          ) => Promise<
            (input: string, options?: { pooling?: "mean"; normalize?: boolean }) => Promise<{
              data?: ArrayLike<number>;
              dims?: number[];
            }>
          >;
        };

        const extractor = await pipeline("feature-extraction", TEST_MODEL, {
          local_files_only: true,
        });
        const output = await extractor("write a quick sort algorithm.", {
          pooling: "mean",
          normalize: true,
        });
        console.log(`[hf-vfs] embedding dims: ${output.dims?.join("x") ?? "unknown"}`);
        expect((output.data?.length ?? 0) > 0).toBe(true);
      } finally {
        rmSync(localModelRoot, { recursive: true, force: true });
      }
    },
    30 * 60 * 1000,
  );
});
