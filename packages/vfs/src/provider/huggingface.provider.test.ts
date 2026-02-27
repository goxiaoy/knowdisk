import { describe, expect, test } from "bun:test";
import type { VfsMount } from "../vfs.types";
import { createHuggingFaceVfsProvider } from "./huggingface.provider";

function makeMount(providerExtra: Record<string, unknown>): VfsMount {
  return {
    mountId: "m1",
    mountPath: "/models/hf",
    providerType: "huggingface",
    providerExtra,
    syncMetadata: false,
    metadataTtlSec: 60,
    reconcileIntervalMs: 1000,
  };
}

describe("huggingface vfs provider", () => {
  test("validates providerExtra.model and endpoint format", async () => {
    const provider = createHuggingFaceVfsProvider(makeMount({}));

    await expect(
      provider.listChildren({
        mount: makeMount({}),
        parentSourceRef: null,
        limit: 10,
      }),
    ).rejects.toThrow('providerExtra.model must be a non-empty string');

    await expect(
      provider.createReadStream?.({
        mount: makeMount({ endpoint: "   ", model: "x/y" }),
        sourceRef: "onnx/model.onnx",
      }) ?? Promise.resolve(null as never),
    ).rejects.toThrow('providerExtra.endpoint must be a non-empty string');
  });

  test("listChildren lists direct children from huggingface siblings", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(
        JSON.stringify({
          siblings: [
            { rfilename: "onnx/model.onnx", size: 100 },
            { rfilename: "onnx/model.onnx_data", size: 200 },
            { rfilename: "config.json", size: 10 },
            { rfilename: "README.md", size: 999 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const mount = makeMount({
      endpoint: "https://huggingface.co/",
      model: "org/repo",
    });
    const provider = createHuggingFaceVfsProvider(mount, { fetch: mockFetch });

    const root = await provider.listChildren({
      mount,
      parentSourceRef: null,
      limit: 10,
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://huggingface.co/api/models/org/repo");
    expect(root.items.map((item) => `${item.kind}:${item.name}`)).toEqual([
      "file:config.json",
      "folder:onnx",
    ]);

    const onnx = await provider.listChildren({
      mount,
      parentSourceRef: "onnx",
      limit: 10,
    });
    expect(onnx.items.map((item) => `${item.kind}:${item.name}`)).toEqual([
      "file:model.onnx",
      "file:model.onnx_data",
    ]);
  });

  test("createReadStream fetches remote file by sourceRef", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]));
        controller.close();
      },
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;

    const mount = makeMount({
      endpoint: "https://huggingface.co",
      model: "org/my model",
    });
    const provider = createHuggingFaceVfsProvider(mount, { fetch: mockFetch });

    const result = await provider.createReadStream?.({
      mount,
      sourceRef: "onnx/model.onnx",
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe(
      "https://huggingface.co/org/my%20model/resolve/main/onnx/model.onnx",
    );
    expect(result).toBe(stream);
  });

  test("createReadStream sends range header when offset/length are provided", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close();
      },
    });
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch: typeof fetch = (async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      fetchCalls.push({ url: String(input), init });
      return new Response(stream, { status: 206 });
    }) as typeof fetch;
    const mount = makeMount({
      endpoint: "https://huggingface.co",
      model: "org/repo",
    });
    const provider = createHuggingFaceVfsProvider(mount, { fetch: mockFetch });

    await provider.createReadStream?.({
      mount,
      sourceRef: "onnx/model.onnx",
      offset: 10,
      length: 20,
    });

    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.init?.headers).toEqual({ Range: "bytes=10-29" });
  });

  test("createReadStream rejects sourceRef outside whitelist", async () => {
    const mockFetch: typeof fetch = (async () => {
      throw new Error("should not call fetch");
    }) as typeof fetch;
    const mount = makeMount({
      endpoint: "https://huggingface.co",
      model: "org/repo",
    });
    const provider = createHuggingFaceVfsProvider(mount, { fetch: mockFetch });

    await expect(
      provider.createReadStream?.({
        mount,
        sourceRef: "README.md",
      }) ?? Promise.resolve(null as never),
    ).rejects.toThrow('sourceRef is not allowed by whitelist: "README.md"');
  });
});
