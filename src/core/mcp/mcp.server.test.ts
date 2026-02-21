import { expect, test } from "bun:test";
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
