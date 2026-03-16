import type {
  GetFileMarkdownResponse,
  ListFilesNodesResponse,
  PickAndMountLocalDirectoryResponse,
} from "../../../shared/files";

export type FilesApi = {
  listFilesNodes: (parentNodeId: string | null) => Promise<ListFilesNodesResponse>;
  pickAndMountLocalDirectory: () => Promise<PickAndMountLocalDirectoryResponse>;
  getFileMarkdown: (nodeId: string) => Promise<GetFileMarkdownResponse>;
};
