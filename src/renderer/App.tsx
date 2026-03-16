import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  DeleteFileNodeResponse,
  GetFileMarkdownResponse,
  GetFileNodeMetadataResponse,
  ListFilesNodesResponse,
  MountLocalDirectoryResponse,
  PickLocalDirectoryResponse,
  RenameFileNodeResponse,
} from "../shared/files";
import { AppShell, type MainRoute } from "@/components/app-shell";
import { FALLBACK_INDEX_STATUS, type RendererIndexStatus } from "../shared/index-status";
import { FALLBACK_MODEL_STATUS, type RendererModelStatus } from "../shared/model-status";
import { ELECTROBUN_RPC_MAX_REQUEST_TIME } from "./rpc-config";
import { FALLBACK_VECTOR_DB_STATUS, type RendererVectorDbStatus } from "../shared/vector-db-status";
import { FALLBACK_VFS_STATUS, type RendererVfsStatus } from "../shared/vfs-status";

const DEFAULT_ROUTE: MainRoute = "/chat";

type AppRPCSchema = {
  bun: {
    requests: {
      getModelStatus: {
        params: undefined;
        response: RendererModelStatus;
      };
      getVfsStatus: {
        params: undefined;
        response: RendererVfsStatus;
      };
      getIndexStatus: {
        params: undefined;
        response: RendererIndexStatus;
      };
      listFilesNodes: {
        params: { parentNodeId: string | null; cursor?: string; limit?: number };
        response: ListFilesNodesResponse;
      };
      pickLocalDirectory: {
        params: undefined;
        response: PickLocalDirectoryResponse;
      };
      mountLocalDirectory: {
        params: { directory: string };
        response: MountLocalDirectoryResponse;
      };
      getFileMarkdown: {
        params: { nodeId: string };
        response: GetFileMarkdownResponse;
      };
      getFileNodeMetadata: {
        params: { nodeId: string };
        response: GetFileNodeMetadataResponse;
      };
      deleteFileNode: {
        params: { nodeId: string };
        response: DeleteFileNodeResponse;
      };
      renameFileNode: {
        params: { nodeId: string; name: string };
        response: RenameFileNodeResponse;
      };
      getVectorDbStatus: {
        params: undefined;
        response: RendererVectorDbStatus;
      };
    };
    messages: Record<never, never>;
  };
  webview: {
    requests: Record<never, never>;
    messages: {
      modelStatusUpdated: RendererModelStatus;
      vfsStatusUpdated: RendererVfsStatus;
    };
  };
};

function parseRoute(hash: string): MainRoute {
  const normalized = hash.startsWith("#") ? hash.slice(1) : hash;
  if (normalized === "/search") {
    return "/search";
  }
  if (normalized === "/files") {
    return "/files";
  }

  return DEFAULT_ROUTE;
}

function readRouteFromWindow(): MainRoute {
  if (typeof window === "undefined") {
    return DEFAULT_ROUTE;
  }

  return parseRoute(window.location.hash);
}

interface AppProps {
  initialRoute?: MainRoute;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRpcError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const lowered = message.toLowerCase();
  return lowered.includes("timed out") || lowered.includes("rpc unavailable");
}

export function App({ initialRoute }: AppProps) {
  const [route, setRoute] = useState<MainRoute>(() => initialRoute ?? readRouteFromWindow());
  const [modelStatus, setModelStatus] = useState<RendererModelStatus>(FALLBACK_MODEL_STATUS);
  const [indexStatus, setIndexStatus] = useState<RendererIndexStatus>(FALLBACK_INDEX_STATUS);
  const [vfsStatus, setVfsStatus] = useState<RendererVfsStatus>(FALLBACK_VFS_STATUS);
  const [vectorDbStatus, setVectorDbStatus] =
    useState<RendererVectorDbStatus>(FALLBACK_VECTOR_DB_STATUS);
  const rpcRef = useRef<null | {
    request: {
      listFilesNodes: (input: {
        parentNodeId: string | null;
        cursor?: string;
        limit?: number;
      }) => Promise<ListFilesNodesResponse>;
      pickLocalDirectory: () => Promise<PickLocalDirectoryResponse>;
      mountLocalDirectory: (input: { directory: string }) => Promise<MountLocalDirectoryResponse>;
      getFileMarkdown: (input: { nodeId: string }) => Promise<GetFileMarkdownResponse>;
      getFileNodeMetadata: (input: { nodeId: string }) => Promise<GetFileNodeMetadataResponse>;
      deleteFileNode: (input: { nodeId: string }) => Promise<DeleteFileNodeResponse>;
      getModelStatus: () => Promise<RendererModelStatus>;
      getIndexStatus: () => Promise<RendererIndexStatus>;
      getVfsStatus: () => Promise<RendererVfsStatus>;
      renameFileNode: (input: { nodeId: string; name: string }) => Promise<RenameFileNodeResponse>;
      getVectorDbStatus: () => Promise<RendererVectorDbStatus>;
    };
  }>(null);

  const requestWithRetry = useCallback(
    async <T,>(run: () => Promise<T>): Promise<T> => {
      let attempt = 0;
      while (true) {
        try {
          return await run();
        } catch (error) {
          attempt += 1;
          if (attempt >= 3 || !isRetryableRpcError(error)) {
            throw error;
          }
          await sleep(attempt * 120);
        }
      }
    },
    []
  );

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const syncFromHash = () => {
      const nextRoute = parseRoute(window.location.hash);
      setRoute(nextRoute);

      if (window.location.hash !== `#${nextRoute}`) {
        window.location.hash = nextRoute;
      }
    };

    syncFromHash();
    window.addEventListener("hashchange", syncFromHash);

    return () => {
      window.removeEventListener("hashchange", syncFromHash);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const initModelStatusBridge = async () => {
      try {
        const { Electroview } = await import("electrobun/view");

        const rpc = Electroview.defineRPC<AppRPCSchema>({
          maxRequestTime: ELECTROBUN_RPC_MAX_REQUEST_TIME,
          handlers: {
            requests: {},
            messages: {
              modelStatusUpdated(status) {
                if (!cancelled) {
                  setModelStatus(status);
                }
              },
              vfsStatusUpdated(status) {
                if (!cancelled) {
                  setVfsStatus(status);
                }
              },
            },
          },
        });
        new Electroview({ rpc });
        rpcRef.current = rpc;

        const status = await requestWithRetry(() => rpc.request.getModelStatus());
        if (!cancelled) {
          setModelStatus(status);
        }
        const nextVfsStatus = await requestWithRetry(() => rpc.request.getVfsStatus());
        if (!cancelled) {
          setVfsStatus(nextVfsStatus);
        }
        const nextIndexStatus = await requestWithRetry(() => rpc.request.getIndexStatus());
        if (!cancelled) {
          setIndexStatus(nextIndexStatus);
        }
        const nextVectorDbStatus = await requestWithRetry(() => rpc.request.getVectorDbStatus());
        if (!cancelled) {
          setVectorDbStatus(nextVectorDbStatus);
        }
      } catch {
        if (!cancelled) {
          setModelStatus(FALLBACK_MODEL_STATUS);
          setIndexStatus(FALLBACK_INDEX_STATUS);
          setVfsStatus(FALLBACK_VFS_STATUS);
          setVectorDbStatus(FALLBACK_VECTOR_DB_STATUS);
        }
      }
    };

    void initModelStatusBridge();

    return () => {
      cancelled = true;
    };
  }, [requestWithRetry]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const refreshIndexStatus = async () => {
      if (!rpcRef.current) {
        return;
      }
      try {
        const nextStatus = await requestWithRetry(() => rpcRef.current!.request.getIndexStatus());
        if (!cancelled) {
          setIndexStatus(nextStatus);
        }
      } catch {
        if (!cancelled) {
          setIndexStatus(FALLBACK_INDEX_STATUS);
        }
      }
    };

    void refreshIndexStatus();
    const intervalId = window.setInterval(() => {
      void refreshIndexStatus();
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [requestWithRetry]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    const refreshVectorDbStatus = async () => {
      if (!rpcRef.current) {
        return;
      }
      try {
        const nextStatus = await requestWithRetry(() => rpcRef.current!.request.getVectorDbStatus());
        if (!cancelled) {
          setVectorDbStatus(nextStatus);
        }
      } catch {
        if (!cancelled) {
          setVectorDbStatus(FALLBACK_VECTOR_DB_STATUS);
        }
      }
    };

    void refreshVectorDbStatus();
    const intervalId = window.setInterval(() => {
      void refreshVectorDbStatus();
    }, 10_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [requestWithRetry]);

  const navigate = (nextRoute: MainRoute) => {
    if (typeof window === "undefined") {
      setRoute(nextRoute);
      return;
    }

    window.location.hash = nextRoute;
  };

  const listFilesNodes = useCallback(
    async (input: {
      parentNodeId: string | null;
      cursor?: string;
      limit?: number;
    }): Promise<ListFilesNodesResponse> => {
      if (!rpcRef.current) {
        return { items: [] };
      }
      return requestWithRetry(() => rpcRef.current!.request.listFilesNodes(input));
    },
    [requestWithRetry]
  );

  const pickLocalDirectory = useCallback(async (): Promise<PickLocalDirectoryResponse> => {
    if (!rpcRef.current) {
      return { ok: false, error: "RPC unavailable" };
    }
    return rpcRef.current.request.pickLocalDirectory();
  }, []);

  const mountLocalDirectory = useCallback(
    async (directory: string): Promise<MountLocalDirectoryResponse> => {
      if (!rpcRef.current) {
        return { ok: false, error: "RPC unavailable" };
      }
      return requestWithRetry(() => rpcRef.current!.request.mountLocalDirectory({ directory }));
    },
    [requestWithRetry]
  );

  const getFileMarkdown = useCallback(async (nodeId: string): Promise<GetFileMarkdownResponse> => {
    if (!rpcRef.current) {
      return { ok: false, error: "RPC unavailable" };
    }
    return requestWithRetry(() => rpcRef.current!.request.getFileMarkdown({ nodeId }));
  }, [requestWithRetry]);

  const getFileNodeMetadata = useCallback(
    async (nodeId: string): Promise<GetFileNodeMetadataResponse> => {
      if (!rpcRef.current) {
        return { ok: false, error: "RPC unavailable" };
      }
      return requestWithRetry(() => rpcRef.current!.request.getFileNodeMetadata({ nodeId }));
    },
    [requestWithRetry]
  );

  const deleteFileNode = useCallback(
    async (nodeId: string): Promise<DeleteFileNodeResponse> => {
      if (!rpcRef.current) {
        return { ok: false, error: "RPC unavailable" };
      }
      return requestWithRetry(() => rpcRef.current!.request.deleteFileNode({ nodeId }));
    },
    [requestWithRetry]
  );

  const renameFileNode = useCallback(
    async (input: {
      nodeId: string;
      name: string;
    }): Promise<RenameFileNodeResponse> => {
      if (!rpcRef.current) {
        return { ok: false, error: "RPC unavailable" };
      }
      return requestWithRetry(() => rpcRef.current!.request.renameFileNode(input));
    },
    [requestWithRetry]
  );

  const filesApi = useMemo(
    () => ({
      listFilesNodes,
      pickLocalDirectory,
      mountLocalDirectory,
      getFileMarkdown,
      getFileNodeMetadata,
      deleteFileNode,
      renameFileNode,
    }),
    [
      deleteFileNode,
      getFileMarkdown,
      getFileNodeMetadata,
      listFilesNodes,
      mountLocalDirectory,
      pickLocalDirectory,
      renameFileNode,
    ]
  );

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      indexStatus={indexStatus}
      modelStatus={modelStatus}
      vfsStatus={vfsStatus}
      vectorDbStatus={vectorDbStatus}
      filesApi={filesApi}
    />
  );
}
