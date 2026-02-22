import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
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
  let requestQueue: Promise<void> = Promise.resolve();

  const runSearch = async (args: { query: string; top_k?: number }) => {
    if (!(deps.isEnabled?.() ?? true)) {
      throw new Error("MCP_DISABLED");
    }
    const results = await deps.retrieval.search(args.query, {
      topK: args.top_k ?? 5,
    });
    return { results };
  };

  const registerSearchTool = (server: McpServer) =>
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

  registerSearchTool(server);

  return {
    async handleHttpRequest(request: Request) {
      const run = async () => {
        await server.close().catch(() => undefined);
        const transport = new WebStandardStreamableHTTPServerTransport({
          // transport is request-scoped in stateless mode
          sessionIdGenerator: undefined,
          enableJsonResponse: true,
        });
        await server.connect(transport);
        const response = await transport.handleRequest(request);
        await server.close().catch(() => undefined);
        return response;
      };
      const task = requestQueue.then(run, run);
      requestQueue = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
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
