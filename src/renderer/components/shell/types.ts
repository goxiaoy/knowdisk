import type { RendererModelStatus } from "../../../shared/model-status";
import type { RendererVfsStatus } from "../../../shared/vfs-status";
import type { FilesApi } from "../files/types";

export type MainRoute = "/chat" | "/search" | "/files";

export type AppShellProps = {
  route: MainRoute;
  onNavigate: (route: MainRoute) => void;
  modelStatus: RendererModelStatus;
  vfsStatus: RendererVfsStatus;
  filesApi: FilesApi;
};
