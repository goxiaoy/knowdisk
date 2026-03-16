import { useEffect, useRef, useState } from "react";
import type {
  GetFileMarkdownResponse,
  ListFilesNodesResponse,
  PickAndMountLocalDirectoryResponse,
} from "../shared/files";
import { AppShell, type MainRoute } from "@/components/app-shell";
import { FALLBACK_MODEL_STATUS, type RendererModelStatus } from "../shared/model-status";
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
      listFilesNodes: {
        params: { parentNodeId: string | null };
        response: ListFilesNodesResponse;
      };
      pickAndMountLocalDirectory: {
        params: undefined;
        response: PickAndMountLocalDirectoryResponse;
      };
      getFileMarkdown: {
        params: { nodeId: string };
        response: GetFileMarkdownResponse;
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

export function App({ initialRoute }: AppProps) {
  const [route, setRoute] = useState<MainRoute>(() => initialRoute ?? readRouteFromWindow());
  const [modelStatus, setModelStatus] = useState<RendererModelStatus>(FALLBACK_MODEL_STATUS);
  const [vfsStatus, setVfsStatus] = useState<RendererVfsStatus>(FALLBACK_VFS_STATUS);
  const rpcRef = useRef<null | {
    request: {
      listFilesNodes: (input: { parentNodeId: string | null }) => Promise<ListFilesNodesResponse>;
      pickAndMountLocalDirectory: () => Promise<PickAndMountLocalDirectoryResponse>;
      getFileMarkdown: (input: { nodeId: string }) => Promise<GetFileMarkdownResponse>;
      getModelStatus: () => Promise<RendererModelStatus>;
      getVfsStatus: () => Promise<RendererVfsStatus>;
    };
  }>(null);

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

        const status = await rpc.request.getModelStatus();
        if (!cancelled) {
          setModelStatus(status);
        }
        const nextVfsStatus = await rpc.request.getVfsStatus();
        if (!cancelled) {
          setVfsStatus(nextVfsStatus);
        }
      } catch {
        if (!cancelled) {
          setModelStatus(FALLBACK_MODEL_STATUS);
          setVfsStatus(FALLBACK_VFS_STATUS);
        }
      }
    };

    void initModelStatusBridge();

    return () => {
      cancelled = true;
    };
  }, []);

  const navigate = (nextRoute: MainRoute) => {
    if (typeof window === "undefined") {
      setRoute(nextRoute);
      return;
    }

    window.location.hash = nextRoute;
  };

  const listFilesNodes = async (parentNodeId: string | null): Promise<ListFilesNodesResponse> => {
    if (!rpcRef.current) {
      return { items: [] };
    }
    return rpcRef.current.request.listFilesNodes({ parentNodeId });
  };

  const pickAndMountLocalDirectory = async (): Promise<PickAndMountLocalDirectoryResponse> => {
    if (!rpcRef.current) {
      return { ok: false, error: "RPC unavailable" };
    }
    return rpcRef.current.request.pickAndMountLocalDirectory();
  };

  const getFileMarkdown = async (nodeId: string): Promise<GetFileMarkdownResponse> => {
    if (!rpcRef.current) {
      return { ok: false, error: "RPC unavailable" };
    }
    return rpcRef.current.request.getFileMarkdown({ nodeId });
  };

  return (
    <AppShell
      route={route}
      onNavigate={navigate}
      modelStatus={modelStatus}
      vfsStatus={vfsStatus}
      filesApi={{
        listFilesNodes,
        pickAndMountLocalDirectory,
        getFileMarkdown,
      }}
    />
  );
}
