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
      providerOverrides: {
        huggingface: () => mockHfProvider(),
      },
    });

    try {
      const baseUrl = app.baseUrl;
      const stateRes = await fetch(`${baseUrl}/api/state`);
      expect(stateRes.status).toBe(200);
      const state = await stateRes.json();
      const pageRes = await fetch(`${baseUrl}/`);
      expect(pageRes.status).toBe(200);
      const pageHtml = await pageRes.text();
      expect(pageHtml).toContain("<th>Create Time</th>");
      expect(pageHtml).toContain("<th>Modify Time</th>");
      expect(Array.isArray(state.mounts)).toBe(true);
      expect(state.mounts.length).toBe(2);
      expect(
        state.mounts.some(
          (mount: { mountId: string }) =>
            mount.mountId === "hf-tiny-random-bert",
        ),
      ).toBe(true);
      expect(
        state.mounts.some((mount: { mountId: string }) => mount.mountId !== "hf-tiny-random-bert"),
      ).toBe(true);
      const localMount = state.mounts.find((mount: { mountId: string }) => mount.mountId !== "hf-tiny-random-bert");
      expect(localMount?.mountNodeId).toEqual(expect.any(String));

      let listed: { items: Array<{ name: string; kind: string; nodeId: string }> } = { items: [] };
      const deadline = Date.now() + 2_000;
      while (Date.now() < deadline) {
        const listRes = await fetch(
          `${baseUrl}/api/list?parentNodeId=${encodeURIComponent(localMount.mountNodeId)}&limit=50`,
        );
        expect(listRes.status).toBe(200);
        listed = await listRes.json();
        if (
          listed.items.some(
            (item: { name: string; kind: string }) =>
              item.name === "hello.txt" && item.kind === "file",
          )
        ) {
          break;
        }
        await Bun.sleep(50);
      }
      expect(Array.isArray(listed.items)).toBe(true);
      expect(
        listed.items.some(
          (item: { name: string; kind: string }) =>
            item.name === "hello.txt" && item.kind === "file",
        ),
      ).toBe(true);
      const hello = listed.items.find((item: { name: string }) => item.name === "hello.txt");
      expect(hello?.nodeId).toEqual(expect.any(String));

      const metadataRes = await fetch(
        `${baseUrl}/api/metadata?nodeId=${encodeURIComponent(hello.nodeId)}`,
      );
      expect(metadataRes.status).toBe(200);
      const metadataPayload = await metadataRes.json();
      expect(metadataPayload.metadata).toEqual(
        expect.objectContaining({
          nodeId: hello.nodeId,
          name: "hello.txt",
          kind: "file",
        }),
      );

      const badListRes = await fetch(
        `${baseUrl}/api/list?parentNodeId=${encodeURIComponent("invalid-node-id")}&limit=50`,
      );
      expect(badListRes.status).toBe(404);
      const badListPayload = await badListRes.json();
      expect(badListPayload.error).toContain("Parent node not found");

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
