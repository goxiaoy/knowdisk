import type { RendererModelStatus } from "../../../shared/model-status";
import type { RendererIndexStatus } from "../../../shared/index-status";
import type { RendererVectorDbStatus } from "../../../shared/vector-db-status";
import type { RendererVfsStatus } from "../../../shared/vfs-status";
import type { FilesApi } from "../files/types";
import type { GetFileMarkdownResponse, SearchResponse } from "../../../shared/files";

export type MainRoute = "/chat" | "/search" | "/files";

export type AppShellProps = {
  route: MainRoute;
  onNavigate: (route: MainRoute) => void;
  modelStatus: RendererModelStatus;
  indexStatus: RendererIndexStatus;
  vfsStatus: RendererVfsStatus;
  vectorDbStatus: RendererVectorDbStatus;
  filesApi: FilesApi;
  searchApi: {
    search: (input: { query: string; titleOnly?: boolean }) => Promise<SearchResponse>;
    getFileMarkdown: (nodeId: string) => Promise<GetFileMarkdownResponse>;
  };
};

export type ShellSearchApi = AppShellProps["searchApi"];
