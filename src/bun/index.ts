import type { VfsNode, VfsSyncerEvent } from "@knowdisk/vfs";
import { readFile } from "node:fs/promises";
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
import { type RendererModelStatus } from "../shared/model-status";
import {
  FALLBACK_VFS_STATUS,
  type RendererVfsMountStatus,
  type RendererVfsStatus,
} from "../shared/vfs-status";
import { type RendererVectorDbStatus } from "../shared/vector-db-status";
import { createAppContainer } from "./app.container";
import { buildParserDocumentPath, deriveMarkdownTitle } from "./parser-artifacts";
import { createPythonWorkerAppRuntime } from "./python/app-runtime";
import { resolvePythonWorkerCommandForRuntime } from "./python/command";
import { sanitizePythonWorkerStderrLine } from "./python/logging";
import { createPythonWorkerRuntime } from "./python/runtime";
import { createPythonWorkerStatusStore } from "./python/status";
import { createPythonWorkerTransport } from "./python/transport";
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
const pythonWorkerTransport = createPythonWorkerTransport({
  command: resolvePythonWorkerCommandForRuntime({
    platform: process.platform,
    isPackaged: process.env.NODE_ENV !== "development",
    execPath: process.execPath,
  }),
});
const pythonWorkerRuntime = createPythonWorkerRuntime({
  transport: pythonWorkerTransport,
  maxRestarts: 2,
  startupConfig: {
    basePath: app.config.basePath,
    embeddingModel: "Alibaba-NLP/gte-multilingual-base",
    rerankerModel: "Alibaba-NLP/gte-multilingual-reranker-base",
    preferredDevice: process.platform === "darwin" ? "mps" : "cpu",
  },
});
const pythonWorkerStatus = createPythonWorkerStatusStore();
const pythonWorkerAppRuntime = createPythonWorkerAppRuntime({
  contentRootDir: app.paths.vfsContentRootDir,
  request: (method, params) => pythonWorkerTransport.request(method, params),
  vfs: app.vfs,
  vfsRepository: app.vfsRepository,
  logger: app.logger,
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

function mapIndexStatus(): RendererIndexStatus {
  return pythonWorkerStatus.getIndexStatus();
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
    const markdown = await readFile(
      buildParserDocumentPath({
        basePath: app.config.basePath,
        nodeId: input.nodeId,
      }),
      "utf8"
    );
    return {
      ok: true,
      markdown,
      title: deriveMarkdownTitle(markdown, node.name),
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error && "code" in error && error.code === "ENOENT"
          ? "preview is not available yet"
          : error instanceof Error
            ? error.message
            : String(error),
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
  return pythonWorkerStatus.getVectorDbStatus();
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
        return pythonWorkerStatus.getModelStatus();
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

const stopPythonWorkerStatusSubscription = pythonWorkerRuntime.subscribeStatusEvents((event) => {
  pythonWorkerStatus.applyEvent(event);
  if (event.type !== "statusSnapshot" && event.type !== "model_status_changed") {
    return;
  }
  try {
    rpc.send.modelStatusUpdated(pythonWorkerStatus.getModelStatus());
  } catch (error) {
    if (isMissingRpcSendTransportError(error)) {
      return;
    }
    app.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to push python worker model status update to renderer"
    );
  }
});

const stopPythonWorkerExitSubscription = pythonWorkerTransport.subscribeExit(() => {
  pythonWorkerStatus.reset();
  try {
    rpc.send.modelStatusUpdated(pythonWorkerStatus.getModelStatus());
  } catch (error) {
    if (isMissingRpcSendTransportError(error)) {
      return;
    }
    app.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to push python worker unavailable status to renderer"
    );
  }
});

const stopPythonWorkerStderrSubscription = pythonWorkerTransport.subscribeStderr((chunk) => {
  for (const line of chunk.split("\n")) {
    const trimmed = sanitizePythonWorkerStderrLine(line).trim();
    if (!trimmed) {
      continue;
    }

    try {
      const parsed = JSON.parse(trimmed) as {
        level?: string;
        msg?: string;
        logger?: string;
        [key: string]: unknown;
      };
      const message = typeof parsed.msg === "string" ? parsed.msg : trimmed;
      const level = typeof parsed.level === "string" ? parsed.level : "warn";
      const { msg: _msg, ...fields } = parsed;
      if (level === "error") {
        app.logger.error(fields, message);
      } else if (level === "warn") {
        app.logger.warn(fields, message);
      } else {
        app.logger.info(fields, message);
      }
    } catch {
      app.logger.warn({ chunk: trimmed }, "python worker stderr");
    }
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

void pythonWorkerRuntime.start()
  .then(() => pythonWorkerAppRuntime.start())
  .then(() => app.vfs.start())
  .catch((error) => {
    app.logger.error(
      {
        error: error instanceof Error ? error.message : String(error),
      },
      "failed to start python worker services"
    );
  });

let shutdownPromise: Promise<void> | null = null;

const shutdown = (): Promise<void> => {
  if (shutdownPromise) {
    return shutdownPromise;
  }
  stopPythonWorkerStatusSubscription();
  stopPythonWorkerExitSubscription();
  stopPythonWorkerStderrSubscription();
  stopVfsStatusSubscription();
  stopVfsNodeChangesSubscription();
  pythonWorkerAppRuntime.stop();
  shutdownPromise = pythonWorkerRuntime.stop()
    .catch((error) => {
      app.logger.error(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        "failed to stop python worker runtime"
      );
    })
    .then(() => app.close())
    .catch((error) => {
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
