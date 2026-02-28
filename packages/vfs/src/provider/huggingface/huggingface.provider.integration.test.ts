import { describe, expect, test } from "bun:test";
import { createWriteStream, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { walkProvider } from "../../vfs.provider.walk";
import type { VfsMount } from "../../vfs.types";
import { createHuggingFaceVfsProvider } from "./index";

const TEST_MODEL = "hf-internal-testing/tiny-random-bert";

function makeMount(providerExtra: Record<string, unknown>): VfsMount {
  return {
    mountId: "hf-e2e",
    providerType: "huggingface",
    providerExtra,
    syncMetadata: false,
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
  };
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
  id: string;
  outputPath: string;
  expectedSize?: number;
}) {
  const stream = await input.provider.createReadStream!({
    id: input.id,
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
            `[hf-vfs] downloading ${input.id}: ${formatBytes(loaded)}/${formatBytes(total)} (${pct}%)`,
          );
        } else {
          console.log(`[hf-vfs] downloading ${input.id}: ${formatBytes(loaded)}`);
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

async function runTransformersValidationInNode(input: {
  localModelRoot: string;
  modelName: string;
}): Promise<void> {
  const scriptPath = join(process.cwd(), `.hf-verify-${Date.now()}-${Math.random()}.mjs`);
  try {
    writeFileSync(
      scriptPath,
      [
        'import { env, pipeline } from "@huggingface/transformers";',
        "const modelRoot = process.env.KNOWDISK_LOCAL_MODEL_ROOT;",
        "const modelName = process.env.KNOWDISK_MODEL_NAME;",
        "if (!modelRoot || !modelName) {",
        '  throw new Error("missing model env for verification");',
        "}",
        "env.allowRemoteModels = false;",
        'env.remoteHost = "https://huggingface.co/";',
        "env.localModelPath = modelRoot;",
        "env.cacheDir = modelRoot;",
        'const extractor = await pipeline("feature-extraction", modelName, { local_files_only: true });',
        'const output = await extractor("write a quick sort algorithm.", { pooling: "mean", normalize: true });',
        "const dims = Array.isArray(output?.dims) ? output.dims.join('x') : 'unknown';",
        "const len = output?.data?.length ?? 0;",
        "if (!len || len <= 0) {",
        '  throw new Error("empty embedding output");',
        "}",
        "console.log(`[hf-vfs-node] embedding dims: ${dims}`);",
      ].join("\n"),
    );
    const proc = Bun.spawn(["node", scriptPath], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        KNOWDISK_LOCAL_MODEL_ROOT: input.localModelRoot,
        KNOWDISK_MODEL_NAME: input.modelName,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      proc.exited,
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    if (stdout.trim().length > 0) {
      console.log(stdout.trim());
    }
    if (exitCode !== 0) {
      throw new Error(
        `node transformers validation failed with code ${exitCode}: ${stderr.trim() || "(no stderr)"}`,
      );
    }
  } finally {
    rmSync(scriptPath, { force: true });
  }
}

function isTlsCertificateError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("UNKNOWN_CERTIFICATE_VERIFICATION_ERROR") ||
    message.includes("unknown certificate verification error") ||
    message.includes("CERTIFICATE_VERIFY_FAILED")
  );
}

describe("huggingface vfs provider integration", () => {
  test(
    "downloads model files via vfs and runs transformers.js feature extraction",
    async () => {
      const mount = makeMount({
        model: TEST_MODEL,
      });
      const provider = createHuggingFaceVfsProvider(mount);
      try {
        await provider.listChildren({ parentId: null, limit: 1 });

        const files = (await walkProvider({ provider, mount }))
          .filter((entry) => entry.kind === "file")
          .map((entry) => ({ sourceRef: entry.sourceRef, size: entry.size }));
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
              id: file.sourceRef,
              outputPath,
              expectedSize: file.size,
            });
            console.log(`[hf-vfs] [${i + 1}/${files.length}] done ${file.sourceRef}`);
          }

          console.log(
            `[hf-vfs] transformers env set for node child process: localModelPath=${localModelRoot}`,
          );
          await runTransformersValidationInNode({
            localModelRoot,
            modelName: TEST_MODEL,
          });
          expect(true).toBe(true);
        } finally {
          rmSync(localModelRoot, { recursive: true, force: true });
        }
      } catch (error) {
        if (isTlsCertificateError(error)) {
          const message = error instanceof Error ? error.message : String(error);
          console.warn(`[hf-vfs] skip integration test due TLS issue: ${message}`);
          return;
        }
        throw error;
      }
    },
    30 * 60 * 1000,
  );
});
