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
    writeFileSync(join(sourceDir, "note.md"), "# Hello\n\nPython worker integration");

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
    const runtime = createPythonWorkerRuntime({
      transport,
      maxRestarts: 0,
    });
    activeRuntimes.push(runtime);

    const statusStore = createPythonWorkerStatusStore();
    runtime.subscribeStatusEvents((event) => {
      statusStore.applyEvent(event);
    });

    await runtime.start();
    await waitFor(() => statusStore.getModelStatus().available);

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

    await waitFor(() => statusStore.getVectorDbStatus().chunkCount === 1);

    const searchResult = await transport.request("search", {
      query: "integration",
    });

    expect(statusStore.getIndexStatus().available).toBe(true);
    expect(statusStore.getIndexStatus().phase).toBe("idle");
    expect(statusStore.getVectorDbStatus().chunkCount).toBe(1);
    expect(searchResult).toEqual([
      expect.objectContaining({
        nodeId: "node-1",
        name: "note.md",
        score: expect.any(Number),
      }),
    ]);

    await transport.request("delete_node", { nodeId: "node-1" });
    await waitFor(() => statusStore.getVectorDbStatus().chunkCount === 0);

    expect(statusStore.getVectorDbStatus().chunkCount).toBe(0);
  }, 20_000);
});

async function waitFor(predicate: () => boolean, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("waitFor timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
