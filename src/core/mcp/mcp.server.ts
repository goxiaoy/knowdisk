export type McpServerDeps = {
  retrieval: {
    search: (query: string, opts: { topK: number }) => Promise<unknown[]>;
  };
  isEnabled?: () => boolean;
};

export function createMcpServer(deps: McpServerDeps) {
  return {
    async callTool(name: string, args: { query: string; top_k?: number }) {
      if (name !== "search_local_knowledge") {
        throw new Error("TOOL_NOT_FOUND");
      }
      if (!(deps.isEnabled?.() ?? true)) {
        throw new Error("MCP_DISABLED");
      }

      const results = await deps.retrieval.search(args.query, {
        topK: args.top_k ?? 5,
      });

      return { results };
    },
  };
}
