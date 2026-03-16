import type { ModelDownloadStatus } from "@knowdisk/model";
import type { VfsNode, VfsSyncerEvent } from "@knowdisk/vfs";
import { BrowserWindow, Utils, defineElectrobunRPC } from "electrobun/bun";
import type {
  FileTreeNode,
  GetFileMarkdownRequest,
  GetFileMarkdownResponse,
  ListFilesNodesRequest,
  ListFilesNodesResponse,
  PickAndMountLocalDirectoryResponse,
} from "../shared/files";
import { clampPct, type RendererModelStatus } from "../shared/model-status";
import {
  FALLBACK_VFS_STATUS,
  clampVfsPct,
  type RendererVfsMountStatus,
  type RendererVfsStatus,
} from "../shared/vfs-status";
import { createAppContainer, initializeAppRuntime } from "./app.container";

const DEV_SERVER_PORT = 5173;
const DEV_SERVER_URL = `http://localhost:${DEV_SERVER_PORT}`;
const PROD_VIEW_URL = "views://app/index.html";

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
        params: ListFilesNodesRequest;
        response: ListFilesNodesResponse;
      };
      pickAndMountLocalDirectory: {
        params: undefined;
        response: PickAndMountLocalDirectoryResponse;
      };
      getFileMarkdown: {
        params: GetFileMarkdownRequest;
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

const app = createAppContainer();
const stopRuntimeHooks = initializeAppRuntime(app);

void app.vfs.start().catch((error) => {
  app.logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
    },
    "failed to start vfs runtime"
  );
});

const vfsMountStatus = new Map<string, RendererVfsMountStatus>();
let vfsStatus: RendererVfsStatus = {
  ...FALLBACK_VFS_STATUS,
  available: true,
};

async function hydrateMountedVfsStatus(): Promise<void> {
  let cursor: { mode: "local" | "remote"; token: string } | undefined;
  while (true) {
    const page = await app.vfs.walkChildren({
      parentNodeId: null,
      limit: 200,
      cursor,
    });
    for (const node of page.items) {
      if (node.kind !== "mount" || vfsMountStatus.has(node.mountId)) {
        continue;
      }
      vfsMountStatus.set(node.mountId, {
        mountId: node.mountId,
        phase: "idle",
        progressPct: 100,
        error: "",
      });
    }
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }
  vfsStatus = recomputeVfsStatus();
}

function recomputeVfsStatus(): RendererVfsStatus {
  const mounts = [...vfsMountStatus.values()].sort((a, b) => a.mountId.localeCompare(b.mountId));
  const syncing = mounts.filter((item) => item.phase === "metadata" || item.phase === "content");
  const failed = mounts.find((item) => item.phase === "error");
  const phase: RendererVfsStatus["phase"] = failed ? "error" : syncing.length > 0 ? "syncing" : "idle";
  const progressPct =
    syncing.length > 0
      ? clampVfsPct(
          syncing.reduce((sum, item) => sum + clampVfsPct(item.progressPct), 0) / Math.max(syncing.length, 1)
        )
      : mounts.length > 0
        ? 100
        : 0;

  return {
    available: true,
    phase,
    progressPct,
    error: failed?.error ?? "",
    syncingMounts: syncing.length,
    mounts,
  };
}

function updateVfsMountStatus(mountId: string, event: VfsSyncerEvent): void {
  const current: RendererVfsMountStatus = vfsMountStatus.get(mountId) ?? {
    mountId,
    phase: "idle",
    progressPct: 0,
    error: "",
  };

  if (event.type === "status") {
    const nextPhase = event.payload.isSyncing ? event.payload.phase : "idle";
    vfsMountStatus.set(mountId, {
      ...current,
      phase: nextPhase,
      progressPct: nextPhase === "idle" ? 100 : current.progressPct,
      error: "",
    });
    return;
  }

  if (event.type === "metadata_progress") {
    const pct = event.payload.total > 0 ? (event.payload.processed / event.payload.total) * 100 : 0;
    vfsMountStatus.set(mountId, {
      ...current,
      phase: "metadata",
      progressPct: clampVfsPct(pct),
      error: "",
    });
    return;
  }

  const pct =
    event.payload.totalSize > 0 ? (event.payload.downloadedBytes / event.payload.totalSize) * 100 : 0;
  vfsMountStatus.set(mountId, {
    ...current,
    phase: "content",
    progressPct: clampVfsPct(pct),
    error: "",
  });
}

function mapModelStatus(status: ModelDownloadStatus): RendererModelStatus {
  return {
    phase: status.phase,
    progressPct: clampPct(status.progressPct),
    error: status.error,
    available: true,
    tasks: {
      embedding: status.tasks.embedding
        ? {
            id: status.tasks.embedding.id,
            model: status.tasks.embedding.model,
            state: status.tasks.embedding.state,
            progressPct: clampPct(status.tasks.embedding.progressPct),
            error: status.tasks.embedding.error,
          }
        : null,
      reranker: status.tasks.reranker
        ? {
            id: status.tasks.reranker.id,
            model: status.tasks.reranker.model,
            state: status.tasks.reranker.state,
            progressPct: clampPct(status.tasks.reranker.progressPct),
            error: status.tasks.reranker.error,
          }
        : null,
    },
  };
}

function mapNode(node: VfsNode): FileTreeNode {
  return {
    nodeId: node.nodeId,
    parentId: node.parentId,
    name: node.name,
    kind: node.kind,
  };
}

async function listFilesNodes(input: ListFilesNodesRequest): Promise<ListFilesNodesResponse> {
  let cursor: { mode: "local" | "remote"; token: string } | undefined;
  const items: VfsNode[] = [];

  while (true) {
    const page = await app.vfs.walkChildren({
      parentNodeId: input.parentNodeId,
      limit: 200,
      cursor,
    });
    items.push(...page.items);
    if (!page.nextCursor) {
      break;
    }
    cursor = page.nextCursor;
  }

  return {
    items: items.map(mapNode),
  };
}

async function pickAndMountLocalDirectory(): Promise<PickAndMountLocalDirectoryResponse> {
  try {
    const selected = await Utils.openFileDialog({
      canChooseFiles: false,
      canChooseDirectory: true,
      allowsMultipleSelection: false,
    });
    const directory = selected[0]?.trim();

    if (!directory) {
      return {
        ok: true,
        cancelled: true,
      };
    }

    const mount = await app.vfs.mount({
      providerType: "local",
      providerExtra: { directory },
      autoSync: true,
      syncMetadata: true,
      syncContent: false,
      metadataTtlSec: 30,
      reconcileIntervalMs: 600_000,
    });
    vfsMountStatus.set(mount.mountId, {
      mountId: mount.mountId,
      phase: "idle",
      progressPct: 0,
      error: "",
    });
    vfsStatus = recomputeVfsStatus();
    try {
      rpc.send.vfsStatusUpdated(vfsStatus);
    } catch (error) {
      app.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to push vfs status update after mount"
      );
    }
    await app.vfs.triggerReconcile(mount.mountId);

    return {
      ok: true,
      cancelled: false,
      mountId: mount.mountId,
      directory,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getFileMarkdown(input: GetFileMarkdownRequest): Promise<GetFileMarkdownResponse> {
  try {
    const node = await app.vfs.getMetadata({ id: input.nodeId });
    if (!node) {
      return {
        ok: false,
        error: "node not found",
      };
    }
    if (node.kind !== "file") {
      return {
        ok: false,
        error: "selected node is not a file",
      };
    }

    const document = await app.parser.materializeNode({ nodeId: input.nodeId });
    return {
      ok: true,
      markdown: document.markdown,
      title: document.title,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

void hydrateMountedVfsStatus().catch((error) => {
  app.logger.error(
    {
      error: error instanceof Error ? error.message : String(error),
    },
    "failed to hydrate vfs mount status"
  );
});

const rpc = defineElectrobunRPC<AppRPCSchema>("bun", {
  handlers: {
    requests: {
      getModelStatus() {
        return mapModelStatus(app.modelService.getStatus().getSnapshot());
      },
      getVfsStatus() {
        return vfsStatus;
      },
      listFilesNodes,
      pickAndMountLocalDirectory,
      getFileMarkdown,
    },
    messages: {},
  },
});

const stopModelStatusSubscription = app.modelService.getStatus().subscribe((status) => {
  try {
    rpc.send.modelStatusUpdated(mapModelStatus(status));
  } catch (error) {
    app.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to push model status update to renderer"
    );
  }
});

const stopVfsStatusSubscription =
  app.vfs.subscribeSyncerEvents?.(({ mountId, event }) => {
    updateVfsMountStatus(mountId, event);
    vfsStatus = recomputeVfsStatus();
    try {
      rpc.send.vfsStatusUpdated(vfsStatus);
    } catch (error) {
      app.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to push vfs status update to renderer"
      );
    }
  }) ?? (() => {});

void app.modelService.ensureRequiredModels().catch((error) => {
  const status = app.modelService.getStatus().getSnapshot();
  const message = error instanceof Error ? error.message : String(error);

  if (status.retry.exhausted) {
    app.logger.error(
      {
        error: message,
      },
      "model bootstrap download failed"
    );
    return;
  }

  app.logger.info(
    {
      error: message,
      attempt: status.retry.attempt,
      maxAttempts: status.retry.maxAttempts,
      nextRetryAt: status.retry.nextRetryAt,
    },
    "model bootstrap download pending retry"
  );
});

const mainWindow = new BrowserWindow({
  title: "Knowdisk",
  url:
    process.env.ELECTROBUN_RENDERER_URL?.trim() ||
    (process.env.NODE_ENV === "development" ? DEV_SERVER_URL : PROD_VIEW_URL),
  frame: {
    width: 1400,
    height: 900,
    x: 120,
    y: 100,
  },
  rpc,
});

mainWindow.on("close", () => {
  stopModelStatusSubscription();
  stopVfsStatusSubscription();
  stopRuntimeHooks();
  void app.vfs.close();
  Utils.quit();
});
