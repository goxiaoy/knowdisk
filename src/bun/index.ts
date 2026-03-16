import type { ModelDownloadStatus } from "@knowdisk/model";
import type { VfsNode, VfsSyncerEvent } from "@knowdisk/vfs";
import { basename } from "node:path";
import Electrobun, {
  BrowserWindow,
  Utils,
  defineElectrobunRPC,
} from "electrobun/bun";
import type {
  DeleteFileNodeRequest,
  DeleteFileNodeResponse,
  FileTreeNode,
  GetFileMarkdownRequest,
  GetFileMarkdownResponse,
  GetFileNodeMetadataRequest,
  GetFileNodeMetadataResponse,
  ListFilesNodesRequest,
  ListFilesNodesResponse,
  MountLocalDirectoryRequest,
  MountLocalDirectoryResponse,
  PickLocalDirectoryResponse,
  RenameFileNodeRequest,
  RenameFileNodeResponse,
} from "../shared/files";
import { type RendererIndexStatus } from "../shared/index-status";
import { clampPct, type RendererModelStatus } from "../shared/model-status";
import {
  FALLBACK_VFS_STATUS,
  type RendererVfsMountStatus,
  type RendererVfsStatus,
} from "../shared/vfs-status";
import { type RendererVectorDbStatus } from "../shared/vector-db-status";
import { isParserSupportedFile } from "@knowdisk/parser";
import { createAppContainer, initializeAppRuntime } from "./app.container";
import { isMissingRpcSendTransportError } from "./rpc-transport";
import {
  applyMountNodeChange,
  applyVfsSyncerEvent,
  recomputeVfsStatus as buildRendererVfsStatus,
  refreshVfsMountPendingUnits,
} from "./vfs-status";

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
      getIndexStatus: {
        params: undefined;
        response: RendererIndexStatus;
      };
      listFilesNodes: {
        params: ListFilesNodesRequest;
        response: ListFilesNodesResponse;
      };
      pickLocalDirectory: {
        params: undefined;
        response: PickLocalDirectoryResponse;
      };
      mountLocalDirectory: {
        params: MountLocalDirectoryRequest;
        response: MountLocalDirectoryResponse;
      };
      getFileMarkdown: {
        params: GetFileMarkdownRequest;
        response: GetFileMarkdownResponse;
      };
      getFileNodeMetadata: {
        params: GetFileNodeMetadataRequest;
        response: GetFileNodeMetadataResponse;
      };
      deleteFileNode: {
        params: DeleteFileNodeRequest;
        response: DeleteFileNodeResponse;
      };
      renameFileNode: {
        params: RenameFileNodeRequest;
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
        name: node.name,
        phase: "idle",
        pendingUnits: 0,
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
  return buildRendererVfsStatus([...vfsMountStatus.values()]);
}

async function computeCurrentVfsStatus(): Promise<RendererVfsStatus> {
  const mounts = await refreshVfsMountPendingUnits([...vfsMountStatus.values()], (mountId) =>
    app.vfs.getQueueProgressByMountId(mountId)
  );
  for (const mount of mounts) {
    vfsMountStatus.set(mount.mountId, mount);
  }
  vfsStatus = buildRendererVfsStatus(mounts);
  return vfsStatus;
}

function updateVfsMountStatus(mountId: string, event: VfsSyncerEvent): void {
  const current = vfsMountStatus.get(mountId);
  if (!current) {
    return;
  }
  vfsMountStatus.set(mountId, applyVfsSyncerEvent(current, event));
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

function mapIndexStatus(): RendererIndexStatus {
  const status = app.indexing.getStatus().getSnapshot();
  return {
    available: true,
    phase: status.phase,
    scope: status.scope,
    processedFiles: status.processedFiles,
    totalFiles: status.totalFiles,
    activeNodeName: status.activeNodeName ?? "",
    error: status.error,
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

function parseCursor(raw?: string): { mode: "local" | "remote"; token: string } | undefined {
  if (!raw) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(raw) as { mode?: string; token?: string };
    if ((parsed.mode === "local" || parsed.mode === "remote") && typeof parsed.token === "string") {
      return { mode: parsed.mode, token: parsed.token };
    }
  } catch {
    return undefined;
  }
  return undefined;
}

async function listFilesNodes(input: ListFilesNodesRequest): Promise<ListFilesNodesResponse> {
  const page = await app.vfs.walkChildren({
    parentNodeId: input.parentNodeId,
    limit: Math.max(20, Math.min(500, input.limit ?? 120)),
    cursor: parseCursor(input.cursor),
  });
  return {
    items: page.items.map(mapNode),
    nextCursor: page.nextCursor ? JSON.stringify(page.nextCursor) : undefined,
  };
}

async function pickLocalDirectory(): Promise<PickLocalDirectoryResponse> {
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

    return {
      ok: true,
      cancelled: false,
      directory,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function mountLocalDirectory(
  input: MountLocalDirectoryRequest
): Promise<MountLocalDirectoryResponse> {
  try {
    const directory = input.directory.trim();
    if (!directory) {
      return {
        ok: false,
        error: "directory is required",
      };
    }

    const normalizedDir = directory.replace(/[\\/]+$/, "");
    const mountName = basename(normalizedDir) || normalizedDir;
    const mount = await app.vfs.mount({
      name: mountName,
      providerType: "local",
      providerExtra: { directory },
      autoSync: true,
      syncMetadata: true,
      syncContent: false,
      metadataTtlSec: 30,
      reconcileIntervalMs: 600_000,
    });

    return {
      ok: true,
      mountId: mount.mountId,
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
    if (!isParserSupportedFile(node)) {
      return {
        ok: false,
        error: "preview is not available for this file type",
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

async function getFileNodeMetadata(
  input: GetFileNodeMetadataRequest
): Promise<GetFileNodeMetadataResponse> {
  try {
    const node = await app.vfs.getMetadata({ id: input.nodeId });
    if (!node) {
      return {
        ok: false,
        error: "node not found",
      };
    }

    return {
      ok: true,
      metadata: {
        nodeId: node.nodeId,
        mountId: node.mountId,
        parentId: node.parentId,
        name: node.name,
        kind: node.kind,
        size: node.size,
        mtimeMs: node.mtimeMs,
        sourceRef: node.sourceRef,
        providerVersion: node.providerVersion,
        deletedAtMs: node.deletedAtMs,
        createdAtMs: node.createdAtMs,
        updatedAtMs: node.updatedAtMs,
      },
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function deleteFileNode(input: DeleteFileNodeRequest): Promise<DeleteFileNodeResponse> {
  try {
    await app.vfs.delete({ id: input.nodeId });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function renameFileNode(input: RenameFileNodeRequest): Promise<RenameFileNodeResponse> {
  const nextName = input.name.trim();
  if (!nextName) {
    return {
      ok: false,
      error: "name is required",
    };
  }
  try {
    const renamed = await app.vfs.rename({
      id: input.nodeId,
      name: nextName,
    });
    return {
      ok: true,
      node: mapNode(renamed),
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function getVectorDbStatus(): Promise<RendererVectorDbStatus> {
  return {
    available: true,
    chunkCount: await app.vectorRepository.getChunkCount(),
  };
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
      async getVfsStatus() {
        return computeCurrentVfsStatus();
      },
      getIndexStatus() {
        return mapIndexStatus();
      },
      listFilesNodes,
      pickLocalDirectory,
      mountLocalDirectory,
      getFileMarkdown,
      getFileNodeMetadata,
      deleteFileNode,
      renameFileNode,
      getVectorDbStatus,
    },
    messages: {},
  },
});

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

const stopModelStatusSubscription = app.modelService.getStatus().subscribe((status) => {
  try {
    rpc.send.modelStatusUpdated(mapModelStatus(status));
  } catch (error) {
    if (isMissingRpcSendTransportError(error)) {
      return;
    }
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
      if (isMissingRpcSendTransportError(error)) {
        return;
      }
      app.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to push vfs status update to renderer"
      );
    }
  }) ?? (() => {});

const stopVfsNodeChangesSubscription = app.vfs.subscribeNodeChanges((node) => {
  const nextMounts = applyMountNodeChange([...vfsMountStatus.values()], node);
  if (nextMounts.length === vfsMountStatus.size && node.kind !== "mount") {
    return;
  }
  vfsMountStatus.clear();
  for (const mount of nextMounts) {
    vfsMountStatus.set(mount.mountId, mount);
  }
  vfsStatus = recomputeVfsStatus();
  try {
    rpc.send.vfsStatusUpdated(vfsStatus);
  } catch (error) {
    if (isMissingRpcSendTransportError(error)) {
      return;
    }
    app.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to push vfs mount node change to renderer"
    );
  }
});

let shutdownPromise: Promise<void> | null = null;

const shutdown = (): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  stopModelStatusSubscription();
  stopVfsStatusSubscription();
  stopVfsNodeChangesSubscription();
  stopRuntimeHooks();
  shutdownPromise = app.close().catch((error) => {
    app.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to close application resources"
    );
  });
  return shutdownPromise;
};

Electrobun.events.on("before-quit", (event: { response?: { allow: boolean } }) => {
  if (!shutdownPromise) {
    event.response = { allow: false };
    void shutdown().finally(() => {
      Utils.quit();
    });
  }
});
