import { describe, expect, test } from "bun:test";
import type { VfsMount } from "../../vfs.types";
import { createHuggingFaceVfsProvider } from "./index";

function createMockLogger() {
  const records: Array<{ level: "info" | "warn" | "error" | "debug"; msg: string }> = [];
  return {
    logger: {
      info: (_obj: unknown, msg?: string) => records.push({ level: "info", msg: msg ?? "" }),
      warn: (_obj: unknown, msg?: string) => records.push({ level: "warn", msg: msg ?? "" }),
      error: (_obj: unknown, msg?: string) => records.push({ level: "error", msg: msg ?? "" }),
      debug: (_obj: unknown, msg?: string) => records.push({ level: "debug", msg: msg ?? "" }),
    },
    records,
  };
}

function makeMount(providerExtra: Record<string, unknown>): VfsMount {
  return {
    mountId: "m1",
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
        parentId: null,
        limit: 10,
      }),
    ).rejects.toThrow('providerExtra.model must be a non-empty string');

    const badEndpointProvider = createHuggingFaceVfsProvider(
      makeMount({ endpoint: "   ", model: "x/y" }),
    );
    await expect(
      badEndpointProvider.createReadStream?.({
        id: "onnx/model.onnx",
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
      parentId: null,
      limit: 10,
    });
    expect(fetchCalls).toHaveLength(1);
    expect(fetchCalls[0]?.url).toBe("https://huggingface.co/api/models/org/repo");
    expect(root.items.map((item) => `${item.kind}:${item.name}`)).toEqual([
      "file:config.json",
      "folder:onnx",
    ]);

    const onnx = await provider.listChildren({
      parentId: "onnx",
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
      id: "onnx/model.onnx",
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
      id: "onnx/model.onnx",
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
        id: "README.md",
      }) ?? Promise.resolve(null as never),
    ).rejects.toThrow('id is not allowed by whitelist: "README.md"');
  });

  test("getMetadata returns metadata for a single whitelisted file", async () => {
    const fetchCalls: Array<{ url: string; init?: RequestInit }> = [];
    const mockFetch: typeof fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      fetchCalls.push({ url: String(input), init });
      if (init?.method === "HEAD") {
        return new Response(null, {
          status: 200,
          headers: { "content-length": "456" },
        });
      }
      return new Response(
        JSON.stringify({
          siblings: [
            { rfilename: "onnx/model.onnx", size: 123 },
            { rfilename: "README.md", size: 999 },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const mount = makeMount({
      endpoint: "https://huggingface.co",
      model: "org/repo",
    });
    const provider = createHuggingFaceVfsProvider(mount, { fetch: mockFetch });

    const metadata = await provider.getMetadata?.({
      id: "onnx/model.onnx",
    });
    expect(metadata).toEqual(
      expect.objectContaining({
        sourceRef: "onnx/model.onnx",
        parentId: "onnx",
        name: "model.onnx",
        kind: "file",
        size: 456,
      }),
    );
    expect(fetchCalls.some((call) => call.init?.method === "HEAD")).toBe(true);

    const denied = await provider.getMetadata?.({
      id: "README.md",
    });
    expect(denied).toBeNull();
  });

  test("writes provider operation logs", async () => {
    const mockFetch: typeof fetch = (async () => {
      return new Response(
        JSON.stringify({ siblings: [{ rfilename: "config.json", size: 10 }] }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;
    const mock = createMockLogger();
    const mount = makeMount({
      endpoint: "https://huggingface.co",
      model: "org/repo",
    });
    const provider = createHuggingFaceVfsProvider(mount, {
      fetch: mockFetch,
      logger: mock.logger as never,
    });

    await provider.listChildren({
      parentId: null,
      limit: 10,
    });

    expect(
      mock.records.some(
        (record) =>
          record.level === "info" && record.msg.includes("huggingface listChildren"),
      ),
    ).toBe(true);
  });
});
