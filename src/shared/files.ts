export type FileTreeNodeKind = "mount" | "folder" | "file";

export type FileTreeNode = {
  nodeId: string;
  parentId: string | null;
  name: string;
  kind: FileTreeNodeKind;
};

export type ListFilesNodesRequest = {
  parentNodeId: string | null;
};

export type ListFilesNodesResponse = {
  items: FileTreeNode[];
};

export type PickAndMountLocalDirectoryResponse =
  | {
      ok: true;
      cancelled: true;
    }
  | {
      ok: true;
      cancelled: false;
      mountId: string;
      directory: string;
    }
  | {
      ok: false;
      error: string;
    };

export type GetFileMarkdownRequest = {
  nodeId: string;
};

export type GetFileMarkdownResponse =
  | {
      ok: true;
      markdown: string;
      title: string | null;
    }
  | {
      ok: false;
      error: string;
    };
