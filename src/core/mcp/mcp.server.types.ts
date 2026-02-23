import type { RetrievalService } from "../retrieval/retrieval.service.types";

export type McpServerDeps = {
  retrieval: Pick<RetrievalService, "search">;
  isEnabled?: () => boolean;
};

export type McpServerService = {
  handleHttpRequest: (request: Request) => Promise<Response>;
  close: () => Promise<void>;
  callTool: (
    name: string,
    args: { query: string; top_k?: number },
  ) => Promise<{ results: unknown[] }>;
};
