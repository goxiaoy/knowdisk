import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { VfsProviderAdapter } from "../src/vfs.provider.types";
import { createVfsExampleApp } from "./app";

function mockHfProvider(): VfsProviderAdapter {
  return {
    type: "huggingface",
    capabilities: { watch: false },
    async listChildren() {
      return { items: [] };
    },
    async createReadStream() {
      return new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("hf"));
          controller.close();
        },
      });
    },
  };
}

describe("vfs example app", () => {
  test("initializes two mounts and serves state/list/events endpoints", async () => {
    const root = mkdtempSync(join(tmpdir(), "knowdisk-vfs-example-test-"));
    const testdataDir = join(root, "testdata");
    await mkdir(testdataDir, { recursive: true });
    await writeFile(join(testdataDir, "hello.txt"), "hello");

    const app = await createVfsExampleApp({
      rootDir: root,
      port: 0,
      startSyncOnBoot: false,
      providerOverrides: {
        huggingface: () => mockHfProvider(),
      },
    });

    try {
      const baseUrl = app.baseUrl;
      const stateRes = await fetch(`${baseUrl}/api/state`);
      expect(stateRes.status).toBe(200);
      const state = await stateRes.json();
      expect(Array.isArray(state.mounts)).toBe(true);
      expect(state.mounts.length).toBe(2);
      expect(
        state.mounts.some(
          (mount: { mountPath: string }) =>
            mount.mountPath === ".model/hf-internal-testing/tiny-random-bert",
        ),
      ).toBe(true);
      expect(
        state.mounts.some((mount: { mountPath: string }) => mount.mountPath === "/testdata"),
      ).toBe(true);

      const listRes = await fetch(`${baseUrl}/api/list?path=/testdata&limit=50`);
      expect(listRes.status).toBe(200);
      const listed = await listRes.json();
      expect(Array.isArray(listed.items)).toBe(true);
      expect(
        listed.items.some((item: { name: string; kind: string }) => item.name === "hello.txt" && item.kind === "file"),
      ).toBe(true);

      const eventsRes = await fetch(`${baseUrl}/api/events`);
      expect(eventsRes.status).toBe(200);
      expect(eventsRes.headers.get("content-type")).toContain("text/event-stream");
      eventsRes.body?.cancel();
    } finally {
      await app.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
