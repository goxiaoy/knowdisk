import { afterEach, describe, expect, test } from "bun:test";
import { spawn as spawnChild } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolvePythonWorkerCommand } from "./command";
import { createPythonWorkerRuntime } from "./runtime";
import { createPythonWorkerStatusStore } from "./status";
import { createPythonWorkerTransport } from "./transport";

const activeRuntimes: Array<ReturnType<typeof createPythonWorkerRuntime>> = [];

afterEach(async () => {
  while (activeRuntimes.length > 0) {
    await activeRuntimes.pop()!.stop();
  }
});

describe("python worker integration", () => {
  test("indexes and deletes a local file through the real python worker process", async () => {
    const sourceDir = mkdtempSync(join(tmpdir(), "knowdisk-python-worker-"));
    const basePath = mkdtempSync(join(tmpdir(), "knowdisk-python-worker-base-"));
    writeFileSync(join(sourceDir, "note.md"), "# Hello\n\nPython worker integration");

    const stderrChunks: string[] = [];
    const transport = createPythonWorkerTransport({
      command: resolvePythonWorkerCommand({
        mode: "development",
        repoPythonProjectDir: join(process.cwd(), "python"),
        resourcesDir: "",
      }),
      spawn: (command, args) =>
        spawnChild(command, args, {
          env: {
            ...process.env,
            KNOWDISK_PYTHON_FAKE_MODEL_RUNTIME: "1",
          },
        }),
    });
    transport.subscribeStderr((chunk) => {
      stderrChunks.push(chunk);
    });
    const runtime = createPythonWorkerRuntime({
      transport,
      maxRestarts: 0,
      startupConfig: {
        basePath,
        embeddingModel: "Alibaba-NLP/gte-multilingual-base",
        rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
        preferredDevice: "cpu",
      },
    });
    activeRuntimes.push(runtime);

    const statusStore = createPythonWorkerStatusStore();
    runtime.subscribeStatusEvents((event) => {
      statusStore.applyEvent(event);
    });

    await runtime.start();
    await waitFor(() => statusStore.getModelStatus().available, {
      label: "model available",
      stderr: stderrChunks,
    });

    await transport.request("index_node", {
      node: {
        nodeId: "node-1",
        mountId: "mount-1",
        name: "note.md",
        sourceRef: "note.md",
        providerVersion: "v1",
      },
      mount: {
        mountId: "mount-1",
        providerType: "local",
        syncedContentPath: "",
        localFilePath: join(sourceDir, "note.md"),
      },
    });

    await waitFor(() => statusStore.getVectorDbStatus().chunkCount === 1, {
      label: "vector chunk count reaches 1",
      stderr: stderrChunks,
      timeoutMs: 10_000,
    });

    const searchResult = await transport.request("search", {
      query: "integration",
    });
    await waitFor(() => statusStore.getIndexStatus().phase === "idle", {
      label: "index status returns to idle",
      stderr: stderrChunks,
      timeoutMs: 10_000,
    });

    expect(statusStore.getIndexStatus().available).toBe(true);
    expect(statusStore.getIndexStatus().phase).toBe("idle");
    expect(statusStore.getVectorDbStatus().chunkCount).toBe(1);
    expect(searchResult).toEqual(
      expect.objectContaining({
        query: "integration",
        debug: expect.objectContaining({
          finalResults: [
            expect.objectContaining({
              nodeId: "node-1",
              name: "note.md",
              score: expect.any(Number),
            }),
          ],
        }),
      })
    );

    await transport.request("delete_node", { nodeId: "node-1" });
    await waitFor(() => statusStore.getVectorDbStatus().chunkCount === 0, {
      label: "vector chunk count returns to 0",
      stderr: stderrChunks,
      timeoutMs: 10_000,
    });

    expect(statusStore.getVectorDbStatus().chunkCount).toBe(0);
  }, 30_000);
});

async function waitFor(
  predicate: () => boolean,
  input?: { timeoutMs?: number; label?: string; stderr?: string[] }
): Promise<void> {
  const timeoutMs = input?.timeoutMs ?? 5_000;
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      const stderrTail = input?.stderr?.join("").trim();
      throw new Error(
        stderrTail
          ? `waitFor timeout: ${input?.label ?? "condition"}\nLast stderr:\n${stderrTail}`
          : `waitFor timeout: ${input?.label ?? "condition"}`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
