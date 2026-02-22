import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import type { RetrievalService } from "../retrieval/retrieval.service.types";

export type McpServerDeps = {
  retrieval: Pick<RetrievalService, "search">;
  isEnabled?: () => boolean;
};

export function createMcpServer(deps: McpServerDeps) {
  const server = new McpServer({
    name: "knowdisk-mcp",
    version: "1.0.0",
  });

  const runSearch = async (args: { query: string; top_k?: number }) => {
    if (!(deps.isEnabled?.() ?? true)) {
      throw new Error("MCP_DISABLED");
    }
    const results = await deps.retrieval.search(args.query, {
      topK: args.top_k ?? 5,
    });
    return { results };
  };

  server.registerTool(
    "search_local_knowledge",
    {
      description: "Search local indexed knowledge chunks by semantic similarity.",
      inputSchema: {
        query: z.string().min(1),
        top_k: z.number().int().positive().optional(),
      },
    },
    async (args) => {
      const payload = await runSearch({
        query: args.query,
        top_k: args.top_k,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(payload),
          },
        ],
      };
    },
  );

  return {
    server,
    async connectStdio() {
      const transport = new StdioServerTransport();
      await server.connect(transport);
      return transport;
    },
    async close() {
      await server.close();
    },
    async callTool(name: string, args: { query: string; top_k?: number }) {
      if (name !== "search_local_knowledge") {
        throw new Error("TOOL_NOT_FOUND");
      }
      return runSearch(args);
    },
  };
}
