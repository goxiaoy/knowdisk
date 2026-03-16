import type {
  DeleteFileNodeResponse,
  GetFileMarkdownResponse,
  GetFileNodeMetadataResponse,
  ListFilesNodesResponse,
  MountLocalDirectoryResponse,
  PickLocalDirectoryResponse,
  RenameFileNodeResponse,
} from "../../../shared/files";

export type FilesApi = {
  listFilesNodes: (input: {
    parentNodeId: string | null;
    cursor?: string;
    limit?: number;
  }) => Promise<ListFilesNodesResponse>;
  pickLocalDirectory: () => Promise<PickLocalDirectoryResponse>;
  mountLocalDirectory: (directory: string) => Promise<MountLocalDirectoryResponse>;
  getFileMarkdown: (nodeId: string) => Promise<GetFileMarkdownResponse>;
  getFileNodeMetadata: (nodeId: string) => Promise<GetFileNodeMetadataResponse>;
  deleteFileNode: (nodeId: string) => Promise<DeleteFileNodeResponse>;
  renameFileNode: (input: { nodeId: string; name: string }) => Promise<RenameFileNodeResponse>;
};
