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

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  pattern: string,
  timeoutMs = 2_000,
) {
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const readPromise = reader.read();
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Timed out waiting for ${pattern}`)), 50);
    });
    try {
      const { value, done } = await Promise.race([readPromise, timeoutPromise]);
      if (done) {
        break;
      }
      text += decoder.decode(value, { stream: true });
      if (text.includes(pattern)) {
        return text;
      }
    } catch (error) {
      if (Date.now() >= deadline) {
        throw error;
      }
    }
  }
  throw new Error(`Timed out waiting for ${pattern}`);
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
      const eventsRes = await fetch(`${baseUrl}/api/events`);
      expect(eventsRes.status).toBe(200);
      expect(eventsRes.headers.get("content-type")).toContain("text/event-stream");
      const reader = eventsRes.body!.getReader();
      await readUntil(reader, "event: init");

      const stateRes = await fetch(`${baseUrl}/api/state`);
      expect(stateRes.status).toBe(200);
      const state = await stateRes.json();
      const pageRes = await fetch(`${baseUrl}/`);
      expect(pageRes.status).toBe(200);
      const pageHtml = await pageRes.text();
      expect(pageHtml).toContain("<th>Create Time</th>");
      expect(pageHtml).toContain("<th>Modify Time</th>");
      expect(pageHtml).toContain("<th>Provider Version</th>");
      expect(pageHtml).toContain("<th>Actions</th>");
      expect(pageHtml).toContain("id=\"createKind\"");
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
      expect(localMount?.operations).toEqual({
        create: true,
        rename: true,
        delete: true,
      });
      const hfMount = state.mounts.find((mount: { mountId: string }) => mount.mountId === "hf-tiny-random-bert");
      expect(hfMount?.operations).toEqual({
        create: false,
        rename: false,
        delete: false,
      });

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

      const createRes = await fetch(`${baseUrl}/api/create`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentNodeId: localMount.mountNodeId,
          name: "created-by-name.txt",
        }),
      });
      expect(createRes.status).toBe(200);
      const created = await createRes.json();
      expect(created.node.name).toBe("created-by-name.txt");
      const sseText = await readUntil(reader, created.node.nodeId);
      expect(sseText).toContain("event: vfs-change");
      expect(sseText).toContain(created.node.nodeId);

      const renameRes = await fetch(`${baseUrl}/api/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: created.node.nodeId, name: "renamed.txt" }),
      });
      expect(renameRes.status).toBe(200);
      const renamed = await renameRes.json();
      expect(renamed.node.name).toBe("renamed.txt");

      const deleteRes = await fetch(`${baseUrl}/api/delete`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId: renamed.node.nodeId }),
      });
      expect(deleteRes.status).toBe(200);
      await reader.cancel();
    } finally {
      await app.stop();
      rmSync(root, { recursive: true, force: true });
    }
  });
});
