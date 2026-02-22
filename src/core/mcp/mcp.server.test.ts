import { expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createMcpServer } from "./mcp.server";

test("search_local_knowledge returns retrieval payload", async () => {
  const server = createMcpServer({
    retrieval: {
      async search(_query: string, opts: { topK: number }) {
        return Array.from({ length: opts.topK }, (_, i) => ({
          chunkId: `c${i}`,
          sourcePath: `docs/${i}.md`,
          chunkText: `chunk ${i}`,
          score: 1 - i * 0.1,
          updatedAt: "2026-02-21T00:00:00.000Z",
        }));
      },
    },
  });

  const res = await server.callTool("search_local_knowledge", {
    query: "setup",
    top_k: 3,
  });

  expect(res.results).toHaveLength(3);
  expect(res.results[0]).toHaveProperty("sourcePath");
});

test("search_local_knowledge fails when mcp is disabled", async () => {
  const server = createMcpServer({
    retrieval: {
      async search() {
        return [];
      },
    },
    isEnabled: () => false,
  });

  await expect(server.callTool("search_local_knowledge", { query: "setup" })).rejects.toThrow(
    "MCP_DISABLED",
  );
});

test("http transport supports listTools and callTool", async () => {
  const mcp = createMcpServer({
    retrieval: {
      async search(query: string, opts: { topK: number }) {
        return Array.from({ length: opts.topK }, (_, i) => ({
          chunkId: `c${i}`,
          sourcePath: `docs/${query}-${i}.md`,
          chunkText: `chunk ${i}`,
          score: 1 - i * 0.1,
          updatedAt: "2026-02-21T00:00:00.000Z",
        }));
      },
    },
  });

  const httpServer = Bun.serve({
    port: 0,
    fetch(request: Request) {
      return mcp.handleHttpRequest(request);
    },
  });

  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${httpServer.port}/mcp`));
  const client = new Client({ name: "knowdisk-test-client", version: "1.0.0" }, { capabilities: {} });

  try {
    await withTimeout(client.connect(transport), 3000);
    const tools = await withTimeout(client.listTools(), 3000);
    expect(tools.tools.some((tool) => tool.name === "search_local_knowledge")).toBe(true);

    const result = await withTimeout(
      client.callTool({
        name: "search_local_knowledge",
        arguments: { query: "setup", top_k: 2 },
      }),
      3000,
    );

    const firstContent = result.content[0];
    expect(firstContent?.type).toBe("text");
    expect(firstContent && "text" in firstContent ? firstContent.text.includes("docs/setup-0.md") : false).toBe(
      true,
    );
  } finally {
    await transport.close();
    httpServer.stop(true);
    await mcp.close();
  }
});

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`timeout ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}
