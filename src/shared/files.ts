export type FileTreeNodeKind = "mount" | "folder" | "file";

export type FileTreeNode = {
  nodeId: string;
  parentId: string | null;
  name: string;
  kind: FileTreeNodeKind;
};

export type ListFilesNodesRequest = {
  parentNodeId: string | null;
  cursor?: string;
  limit?: number;
};

export type ListFilesNodesResponse = {
  items: FileTreeNode[];
  nextCursor?: string;
};

export type PickLocalDirectoryResponse =
  | {
      ok: true;
      cancelled: true;
    }
  | {
      ok: true;
      cancelled: false;
      directory: string;
    }
  | {
      ok: false;
      error: string;
    };

export type MountLocalDirectoryRequest = {
  directory: string;
};

export type MountLocalDirectoryResponse =
  | {
      ok: true;
      mountId: string;
    }
  | {
      ok: false;
      error: string;
    };

export type GetFileMarkdownRequest = {
  nodeId: string;
};

export type SearchRequest = {
  query: string;
  titleOnly?: boolean;
};

export type SearchResult = {
  chunkId?: string;
  nodeId: string;
  mountId?: string;
  sourceRef?: string;
  name?: string;
  title?: string;
  text?: string;
  score?: number;
  ftsScore?: number;
  vectorScore?: number;
  rerankScore?: number;
  matchedBy?: string[];
};

export type SearchResponse =
  | {
      ok: true;
      query: string;
      titleOnly: boolean;
      finalResults: SearchResult[];
    }
  | {
      ok: false;
      error: string;
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

export type RenameFileNodeRequest = {
  nodeId: string;
  name: string;
};

export type RenameFileNodeResponse =
  | {
      ok: true;
      node: FileTreeNode;
    }
  | {
      ok: false;
      error: string;
    };

export type DeleteFileNodeRequest = {
  nodeId: string;
};

export type DeleteFileNodeResponse =
  | {
      ok: true;
    }
  | {
      ok: false;
      error: string;
    };

export type FileNodeMetadata = {
  nodeId: string;
  mountId: string;
  parentId: string | null;
  name: string;
  kind: FileTreeNodeKind;
  size: number | null;
  mtimeMs: number | null;
  sourceRef: string;
  providerVersion: string | null;
  deletedAtMs: number | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type GetFileNodeMetadataRequest = {
  nodeId: string;
};

export type GetFileNodeMetadataResponse =
  | {
      ok: true;
      metadata: FileNodeMetadata;
    }
  | {
      ok: false;
      error: string;
    };
