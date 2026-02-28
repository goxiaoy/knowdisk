import "reflect-metadata";
import { rmSync } from "node:fs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import {
  createVfsProviderRegistry,
  createVfsRepository,
  createVfsService,
  createVfsSyncer,
  type VfsMount,
  type VfsNode,
  type VfsProviderAdapter,
  type VfsSyncer,
  type VfsSyncerEvent,
} from "../src";

type ProviderOverrides = Record<string, (mount: VfsMount) => VfsProviderAdapter>;

type MountStatus = {
  mountId: string;
  mountNodeId: string;
  providerType: string;
  isSyncing: boolean;
  phase: "idle" | "metadata" | "content";
  metadata?: {
    total: number;
    processed: number;
    added: number;
    updated: number;
    deleted: number;
  };
  download?: {
    sourceRef: string;
    totalSize: number;
    downloadedBytes: number;
    downloadPath: string;
  };
};

export type VfsExampleApp = {
  baseUrl: string;
  stop: () => Promise<void>;
  mounts: Array<VfsMount & { mountNodeId: string }>;
};

export async function createVfsExampleApp(input?: {
  port?: number;
  rootDir?: string;
  startSyncOnBoot?: boolean;
  providerOverrides?: ProviderOverrides;
}): Promise<VfsExampleApp> {
  const port = input?.port ?? 3099;
  const rootDir = input?.rootDir ?? join(process.cwd(), ".vfs-example");
  const shouldCleanupRoot = false;
  const testdataDir = join(rootDir, "testdata");
  mkdirSync(testdataDir, { recursive: true });
  const contentDir = join(rootDir, "content");
  mkdirSync(contentDir, { recursive: true });
  const dbPath = join(rootDir, "vfs.db");
  writeBootstrapFiles(testdataDir);

  const repository = createVfsRepository({ dbPath });
  const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
  if (input?.providerOverrides) {
    for (const [providerType, factory] of Object.entries(input.providerOverrides)) {
      registry.register(providerType, (_container, mount) => factory(mount));
    }
  }
  const vfs = createVfsService({ repository, registry });

  const hfMount = await vfs.mountInternal("hf-tiny-random-bert", {
    providerType: "huggingface",
    providerExtra: { model: "hf-internal-testing/tiny-random-bert" },
    syncMetadata: false,
    syncContent: true,
    metadataTtlSec: 60,
    reconcileIntervalMs: 60_000,
  });
  const localMount = await vfs.mount({
    providerType: "local",
    providerExtra: { directory: testdataDir },
    syncMetadata: false,
    syncContent: true,
    metadataTtlSec: 30,
    reconcileIntervalMs: 10_000,
  });
  const mounts = [hfMount, localMount];
  const mountsWithNode = mounts.map((mount) => {
    const mountNode = repository
      .listNodesByMountId(mount.mountId)
      .find((node) => node.kind === "mount" && node.sourceRef === "");
    if (!mountNode) {
      throw new Error(`mount node not found: ${mount.mountId}`);
    }
    return { ...mount, mountNodeId: mountNode.nodeId };
  });

  const syncers = mounts.map((mount) =>
    createVfsSyncer({
      mount,
      provider: registry.get(mount),
      repository,
      contentRootParent: contentDir,
    }),
  );

  const statuses = new Map<string, MountStatus>();
  for (const mount of mountsWithNode) {
    statuses.set(mount.mountId, {
      mountId: mount.mountId,
      mountNodeId: mount.mountNodeId,
      providerType: mount.providerType,
      isSyncing: false,
      phase: "idle",
    });
  }

  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const sendEvent = (event: { type: string; payload: unknown }) => {
    const chunk = encoder.encode(
      `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
    );
    for (const listener of listeners) {
      try {
        listener.enqueue(chunk);
      } catch {
        listeners.delete(listener);
      }
    }
  };
  const toStatusArray = () => [...statuses.values()];

  const updateStatus = (mount: VfsMount, event: VfsSyncerEvent) => {
    const prev = statuses.get(mount.mountId);
    if (!prev) {
      return;
    }
    let next: MountStatus = prev;
    if (event.type === "status") {
      next = {
        ...prev,
        isSyncing: event.payload.isSyncing,
        phase: event.payload.phase,
      };
    } else if (event.type === "metadata_progress") {
      next = {
        ...prev,
        metadata: event.payload,
      };
    } else if (event.type === "download_progress") {
      next = {
        ...prev,
        download: event.payload,
      };
    }
    statuses.set(mount.mountId, next);
    sendEvent({
      type: "sync-status",
      payload: next,
    });
  };

  const unsubscribers = syncers.map((syncer, index) =>
    syncer.subscribe((event) => updateStatus(mounts[index]!, event)),
  );

  if (input?.startSyncOnBoot !== false) {
    for (const syncer of syncers) {
      void syncer.fullSync().catch(() => {});
      void syncer.startWatching().catch(() => {});
    }
  }

  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/state") {
        return Response.json({
          rootDir,
          mounts: mountsWithNode,
          statuses: toStatusArray(),
        });
      }

      if (url.pathname === "/api/list") {
        const parentNodeIdParam = url.searchParams.get("parentNodeId");
        const limit = Number(url.searchParams.get("limit") ?? "100");
        const token = url.searchParams.get("cursor");
        const parentNodeId =
          parentNodeIdParam === null || parentNodeIdParam.length === 0
            ? null
            : parentNodeIdParam;
        const result = await vfs.walkChildren({
          parentNodeId,
          limit: Number.isFinite(limit) ? Math.max(1, Math.min(500, Math.floor(limit))) : 100,
          cursor: token ? { mode: "local", token } : undefined,
        });
        return Response.json({
          ...result,
          nextCursor: result.nextCursor?.token,
        });
      }

      if (url.pathname === "/api/events") {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            listeners.add(controller);
            controller.enqueue(
              encoder.encode(
                `event: init\ndata: ${JSON.stringify({
                  statuses: toStatusArray(),
                })}\n\n`,
              ),
            );
          },
          cancel() {
            for (const listener of listeners) {
              listeners.delete(listener);
            }
          },
        });
        return new Response(stream, {
          headers: {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          },
        });
      }

      return new Response(renderHtml({ mounts: mountsWithNode, statuses: toStatusArray() }), {
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    mounts: mountsWithNode,
    async stop() {
      for (const unsubscribe of unsubscribers) {
        unsubscribe();
      }
      for (const syncer of syncers) {
        await syncer.stopWatching().catch(() => {});
      }
      repository.close();
      server.stop(true);
      if (shouldCleanupRoot) {
        rmSync(rootDir, { recursive: true, force: true });
      }
    },
  };
}

function writeBootstrapFiles(testdataDir: string) {
  const readme = join(testdataDir, "README.txt");
  const notes = join(testdataDir, "notes.txt");
  if (!existsSync(readme)) {
    writeFileSync(readme, "This is testdata root for VFS example.\n");
  }
  if (!existsSync(notes)) {
    writeFileSync(notes, "Finder-like browser will show this file.\n");
  }
}

function renderHtml(input: {
  mounts: Array<VfsMount & { mountNodeId: string }>;
  statuses: MountStatus[];
}): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>VFS Example</title>
  <style>
    :root { --bg: #f2f5f7; --panel: #ffffff; --line: #dbe2e8; --text: #1f2933; --muted: #64748b; --brand: #0f766e; --warn: #b45309; font-family: "IBM Plex Sans", "Avenir Next", "Segoe UI", sans-serif; }
    body { margin: 0; background: radial-gradient(circle at top, #e6f4f1 0%, #eef3f7 42%, #f7fafc 100%); color: var(--text); }
    .app { max-width: 1100px; margin: 0 auto; padding: 16px; display: grid; gap: 12px; }
    .status { border: 1px solid var(--line); border-radius: 12px; padding: 12px; background: var(--panel); display: grid; gap: 8px; }
    .status-item { display: flex; justify-content: space-between; gap: 8px; font-size: 13px; }
    .status-idle { color: var(--muted); } .status-sync { color: var(--brand); font-weight: 600; } .status-content { color: var(--warn); font-weight: 600; }
    .finder { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--panel); display: grid; grid-template-columns: 320px 1fr; min-height: 60vh; }
    .left { border-right: 1px solid var(--line); padding: 12px; overflow: auto; }
    .right { padding: 12px; overflow: auto; }
    .path { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
    button.item { width: 100%; border: 1px solid transparent; background: transparent; text-align: left; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
    button.item:hover { background: #f1f5f9; }
    button.item.active { background: #dff4ef; border-color: #a7f3d0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; border-bottom: 1px solid var(--line); text-align: left; }
    .kind-folder { color: #0f766e; } .kind-file { color: #334155; }
  </style>
</head>
<body>
  <div class="app">
    <section class="status">
      <strong>Syncer Status</strong>
      <div id="statuses"></div>
    </section>
    <section class="finder">
      <aside class="left">
        <div class="path">Mounts</div>
        <div id="mounts"></div>
      </aside>
      <main class="right">
        <div class="path" id="currentPath"></div>
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Size</th><th>MTime</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </main>
    </section>
  </div>
  <script>
    const mounts = ${JSON.stringify(input.mounts.map((item) => ({ mountId: item.mountId, mountNodeId: item.mountNodeId })))};
    let statuses = ${JSON.stringify(input.statuses)};
    let selectedPath = mounts[0]?.mountNodeId || "";

    function statusClass(item) {
      if (!item.isSyncing) return "status-idle";
      if (item.phase === "content") return "status-content";
      return "status-sync";
    }

    function renderStatus() {
      const el = document.getElementById("statuses");
      el.innerHTML = statuses.map((item) => {
        const text = item.isSyncing ? item.phase : "idle";
        const download = item.download ? (" | " + item.download.sourceRef + " " + item.download.downloadedBytes + "/" + item.download.totalSize) : "";
        return '<div class="status-item"><span>' + item.mountId + '</span><span class="' + statusClass(item) + '">' + text + download + '</span></div>';
      }).join("");
    }

    function renderMounts() {
      const el = document.getElementById("mounts");
      el.innerHTML = mounts.map((mount) => {
        const active = mount.mountNodeId === selectedPath ? "active" : "";
        return '<button class="item ' + active + '" data-node-id="' + mount.mountNodeId + '">' + mount.mountId + "</button>";
      }).join("");
      el.querySelectorAll("button[data-node-id]").forEach((button) => {
        button.addEventListener("click", () => loadPath(button.getAttribute("data-node-id")));
      });
    }

    async function loadPath(parentNodeId) {
      if (!parentNodeId) return;
      selectedPath = parentNodeId;
      renderMounts();
      document.getElementById("currentPath").textContent = parentNodeId;
      const res = await fetch("/api/list?parentNodeId=" + encodeURIComponent(parentNodeId) + "&limit=200");
      const data = await res.json();
      const rows = document.getElementById("rows");
      rows.innerHTML = (data.items || []).map((item) => {
        const nameCell = item.kind === "folder"
          ? '<button class="item" data-open="' + item.nodeId + '">' + item.name + "</button>"
          : item.name;
        return "<tr><td>" + nameCell + "</td><td class='kind-" + item.kind + "'>" + item.kind + "</td><td>" + (item.size ?? "") + "</td><td>" + (item.mtimeMs ?? "") + "</td></tr>";
      }).join("");
      rows.querySelectorAll("button[data-open]").forEach((button) => {
        button.addEventListener("click", () => loadPath(button.getAttribute("data-open")));
      });
    }

    renderStatus();
    renderMounts();
    if (selectedPath) loadPath(selectedPath);
    const events = new EventSource("/api/events");
    events.addEventListener("sync-status", (event) => {
      const update = JSON.parse(event.data);
      statuses = statuses.map((item) => (item.mountId === update.mountId ? update : item));
      renderStatus();
    });
    events.addEventListener("init", (event) => {
      const payload = JSON.parse(event.data);
      if (Array.isArray(payload.statuses)) {
        statuses = payload.statuses;
        renderStatus();
      }
    });
  </script>
</body>
</html>`;
}
