import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { McpServerDeps, McpServerService } from "./mcp.server.types";

export function createMcpServer(deps: McpServerDeps): McpServerService {
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

  const runGetSourceChunkInfo = async (args: { source_path: string }) => {
    if (!(deps.isEnabled?.() ?? true)) {
      throw new Error("MCP_DISABLED");
    }
    const sourcePath = args.source_path.trim();
    const chunks = await deps.retrieval.getSourceChunkInfoByPath(sourcePath);
    return { sourcePath, chunks };
  };

  const runRetrieveDocumentByPath = async (args: { source_path: string }) => {
    if (!(deps.isEnabled?.() ?? true)) {
      throw new Error("MCP_DISABLED");
    }
    const sourcePath = args.source_path.trim();
    const chunks = await deps.retrieval.retrieveBySourcePath(sourcePath, false);
    return {
      sourcePath,
      chunkCount: chunks.length,
      content: chunks.map((chunk) => chunk.chunkText).join("\n\n"),
      chunks,
    };
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

  const registerSourceChunkInfoTool = (server: McpServer) =>
    server.registerTool(
      "get_source_chunk_info",
      {
        description: "Get raw indexed chunk metadata by source path.",
        inputSchema: {
          source_path: z.string().min(1),
        },
      },
      async (args) => {
        const payload = await runGetSourceChunkInfo({ source_path: args.source_path });
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

  const registerRetrieveDocumentTool = (server: McpServer) =>
    server.registerTool(
      "retrieve_document_by_path",
      {
        description: "Retrieve all indexed chunks and merged content by source path.",
        inputSchema: {
          source_path: z.string().min(1),
        },
      },
      async (args) => {
        const payload = await runRetrieveDocumentByPath({ source_path: args.source_path });
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
  registerSourceChunkInfoTool(server);
  registerRetrieveDocumentTool(server);

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
    async callTool(name: string, args: { query?: string; top_k?: number; source_path?: string }) {
      if (name === "search_local_knowledge") {
        return runSearch({ query: args.query ?? "", top_k: args.top_k });
      }
      if (name === "get_source_chunk_info") {
        return runGetSourceChunkInfo({ source_path: args.source_path ?? "" });
      }
      if (name === "retrieve_document_by_path") {
        return runRetrieveDocumentByPath({ source_path: args.source_path ?? "" });
      }
      throw new Error("TOOL_NOT_FOUND");
    },
  };
}
