import "reflect-metadata";
import { rmSync } from "node:fs";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { container as rootContainer } from "tsyringe";
import { createExampleLogger } from "./logger";
import {
  createVfsProviderRegistry,
  createVfsRepository,
  createVfsService,
  type VfsMount,
  type VfsProviderAdapter,
} from "../src";

type ProviderOverrides = Record<
  string,
  (mount: VfsMount) => VfsProviderAdapter
>;

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
  mounts: Array<
    VfsMount & {
      mountNodeId: string;
      operations: {
        create: boolean;
        rename: boolean;
        delete: boolean;
      };
    }
  >;
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
  const logger = createExampleLogger();

  const repository = createVfsRepository({ dbPath });
  const exampleContainer = rootContainer.createChildContainer();
  exampleContainer.register("logger", { useValue: logger });
  const registry = createVfsProviderRegistry(exampleContainer);
  if (input?.providerOverrides) {
    for (const [providerType, factory] of Object.entries(
      input.providerOverrides,
    )) {
      registry.register(providerType, (_container, mount) => factory(mount));
    }
  }
  const vfs = createVfsService({
    repository,
    registry,
    contentRootParent: contentDir,
    logger,
  });

  const hfMount = await vfs.mountInternal("hf-tiny-random-bert", {
    providerType: "huggingface",
    providerExtra: { model: "hf-internal-testing/tiny-random-bert" },
    syncMetadata: false,
    syncContent: true,
    metadataTtlSec: 60,
    reconcileIntervalMs: 600_000,
  });
  const localMount = await vfs.mountInternal("local-testdata", {
    providerType: "local",
    providerExtra: { directory: testdataDir },
    syncMetadata: true,
    syncContent: true,
    metadataTtlSec: 30,
    reconcileIntervalMs: 600_000,
  });
  void hfMount;
  void localMount;

  const listMountedNodes = (): Array<
    VfsMount & {
      mountNodeId: string;
      operations: {
        create: boolean;
        rename: boolean;
        delete: boolean;
      };
    }
  > =>
    repository.listNodeMountExts().flatMap((ext) => {
      const mountNode = repository
        .listNodesByMountId(ext.mountId)
        .find(
          (node) =>
            node.kind === "mount" &&
            node.sourceRef === "" &&
            node.deletedAtMs === null,
        );
      if (!mountNode) {
        return [];
      }
      const mount: VfsMount = {
        mountId: ext.mountId,
        providerType: ext.providerType,
        providerExtra: ext.providerExtra,
        autoSync: ext.autoSync,
        syncMetadata: ext.syncMetadata,
        syncContent: ext.syncContent,
        metadataTtlSec: ext.metadataTtlSec,
        reconcileIntervalMs: ext.reconcileIntervalMs,
      };
      const provider = registry.get(mount);
      return [
        {
          ...mount,
          mountNodeId: mountNode.nodeId,
          operations: {
            create: Boolean(provider.create),
            rename: Boolean(provider.rename),
            delete: Boolean(provider.delete),
          },
        },
      ];
    });

  const statuses = new Map<string, MountStatus>();
  const ensureStatus = (mount: VfsMount & { mountNodeId: string }) => {
    if (statuses.has(mount.mountId)) {
      return;
    }
    statuses.set(mount.mountId, {
      mountId: mount.mountId,
      mountNodeId: mount.mountNodeId,
      providerType: mount.providerType,
      isSyncing: false,
      phase: "idle",
    });
  };
  const toStatusArray = () => {
    const mounts = listMountedNodes();
    const active = new Set(mounts.map((mount) => mount.mountId));
    for (const mount of mounts) {
      ensureStatus(mount);
    }
    for (const id of [...statuses.keys()]) {
      if (!active.has(id)) {
        statuses.delete(id);
      }
    }
    return mounts.map((mount) => statuses.get(mount.mountId)!);
  };

  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const sendEvent = (event: { type: string; payload: unknown }) => {
    const chunk = encoder.encode(
      `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`,
    );
    for (const listener of listeners) {
      listener.enqueue(chunk);
    }
  };
  const stopNodeChangesSub = vfs.subscribeNodeChanges((row) => {
    sendEvent({
      type: "vfs-change",
      payload: {
        type: row.deletedAtMs === null ? "update" : "delete",
        id: row.nodeId,
        parentId: row.parentId,
        contentUpdated: null,
        metadataChanged: true,
      },
    });
  });

  if (input?.startSyncOnBoot !== false) {
    await vfs.start();
  }

  const server = Bun.serve({
    port,
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/api/state") {
        return Response.json({
          rootDir,
          mounts: listMountedNodes(),
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
        try {
          const result = await vfs.walkChildren({
            parentNodeId,
            limit: Number.isFinite(limit)
              ? Math.max(1, Math.min(500, Math.floor(limit)))
              : 100,
            cursor: token ? { mode: "local", token } : undefined,
          });
          return Response.json({
            ...result,
            nextCursor: result.nextCursor?.token,
          });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          if (message.includes("Parent node not found")) {
            return Response.json({ error: message }, { status: 404 });
          }
          return Response.json({ error: message }, { status: 500 });
        }
      }

      if (url.pathname === "/api/metadata") {
        const nodeId = url.searchParams.get("nodeId");
        if (!nodeId) {
          return Response.json(
            { error: "nodeId is required" },
            { status: 400 },
          );
        }
        const node = repository.getNodeById(nodeId);
        if (!node) {
          return Response.json({ error: "node not found" }, { status: 404 });
        }

        let metadata = node;
        if (node.kind !== "mount") {
          const ext = repository.getNodeMountExtByMountId(node.mountId);
          if (ext) {
            const mount: VfsMount = {
              mountId: ext.mountId,
              providerType: ext.providerType,
              providerExtra: ext.providerExtra,
              syncMetadata: ext.syncMetadata,
              syncContent: ext.syncContent,
              metadataTtlSec: ext.metadataTtlSec,
              reconcileIntervalMs: ext.reconcileIntervalMs,
            };
            const provider = registry.get(mount);
            if (provider.getMetadata && ext.providerType !== "local") {
              try {
                const fetched = await provider.getMetadata({
                  id: node.sourceRef,
                });
                if (fetched) {
                  metadata = {
                    ...metadata,
                    name: fetched.name,
                    kind: fetched.kind,
                    size: fetched.size,
                    mtimeMs: fetched.mtimeMs,
                    sourceRef: fetched.sourceRef,
                    providerVersion: fetched.providerVersion,
                  };
                }
              } catch {
                // keep db metadata as fallback
              }
            }
          }
        }
        return Response.json({ metadata });
      }

      if (url.pathname === "/api/create" && request.method === "POST") {
        try {
          const body = (await request.json()) as {
            parentNodeId?: string;
            name?: string;
            kind?: "file" | "folder";
          };
          if (!body.parentNodeId) {
            return Response.json(
              { error: "parentNodeId is required" },
              { status: 400 },
            );
          }
          if (!vfs.create) {
            return Response.json(
              { error: "create is not supported" },
              { status: 400 },
            );
          }
          const created = await vfs.create({
            parentId: body.parentNodeId,
            name: body.name,
            kind: body.kind,
          });
          return Response.json({ node: created });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/rename" && request.method === "POST") {
        try {
          const body = (await request.json()) as {
            nodeId?: string;
            name?: string;
          };
          if (!body.nodeId || !body.name) {
            return Response.json(
              { error: "nodeId and name are required" },
              { status: 400 },
            );
          }
          if (!vfs.rename) {
            return Response.json(
              { error: "rename is not supported" },
              { status: 400 },
            );
          }
          const renamed = await vfs.rename({
            id: body.nodeId,
            name: body.name,
          });
          return Response.json({ node: renamed });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 400 });
        }
      }

      if (url.pathname === "/api/delete" && request.method === "POST") {
        try {
          const body = (await request.json()) as {
            nodeId?: string;
          };
          if (!body.nodeId) {
            return Response.json(
              { error: "nodeId is required" },
              { status: 400 },
            );
          }
          if (!vfs.delete) {
            return Response.json(
              { error: "delete is not supported" },
              { status: 400 },
            );
          }
          await vfs.delete({
            id: body.nodeId,
          });
          return Response.json({ ok: true });
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          return Response.json({ error: message }, { status: 400 });
        }
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

      return new Response(
        renderHtml({ mounts: listMountedNodes(), statuses: toStatusArray() }),
        {
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    },
  });

  return {
    baseUrl: `http://127.0.0.1:${server.port}`,
    mounts: listMountedNodes(),
    async stop() {
      stopNodeChangesSub();
      await vfs.close();
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
  mounts: Array<
    VfsMount & {
      mountNodeId: string;
      operations: {
        create: boolean;
        rename: boolean;
        delete: boolean;
      };
    }
  >;
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
    .finder { border: 1px solid var(--line); border-radius: 12px; overflow: hidden; background: var(--panel); display: grid; grid-template-columns: 260px 1fr 340px; min-height: 60vh; }
    .left { border-right: 1px solid var(--line); padding: 12px; overflow: auto; }
    .right { border-right: 1px solid var(--line); padding: 12px; overflow: auto; }
    .meta { padding: 12px; overflow: auto; }
    .path { font-size: 13px; color: var(--muted); margin-bottom: 10px; }
    .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; }
    .toolbar button, .toolbar select { border: 1px solid var(--line); background: #f8fafc; border-radius: 8px; padding: 6px 10px; cursor: pointer; font-size: 12px; }
    .toolbar button:hover { background: #eef2f7; }
    .toolbar button:disabled { opacity: 0.5; cursor: not-allowed; }
    button.item { width: 100%; border: 1px solid transparent; background: transparent; text-align: left; padding: 8px 10px; border-radius: 8px; cursor: pointer; }
    button.item:hover { background: #f1f5f9; }
    button.item.active { background: #dff4ef; border-color: #a7f3d0; }
    table { width: 100%; border-collapse: collapse; font-size: 13px; }
    th, td { padding: 8px; border-bottom: 1px solid var(--line); text-align: left; }
    tr.row { cursor: default; }
    tr.row:hover { background: #f8fafc; }
    tr.row.active { background: #dff4ef; }
    td.actions { white-space: nowrap; text-align: right; }
    td.actions button { border: 1px solid #ef4444; color: #ef4444; background: #fff; border-radius: 6px; padding: 3px 8px; font-size: 12px; cursor: pointer; }
    td.actions button:hover { background: #fff1f2; }
    .name-cell { cursor: text; }
    .kind-folder { color: #0f766e; } .kind-file { color: #334155; }
    .meta-empty { color: var(--muted); font-size: 13px; }
    .meta-grid { width: 100%; border-collapse: collapse; font-size: 13px; }
    .meta-grid th { width: 34%; color: var(--muted); font-weight: 500; }
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
        <div class="toolbar">
          <div class="path" id="currentPath"></div>
          <div>
            <select id="createKind">
              <option value="file">file</option>
              <option value="folder">folder</option>
            </select>
            <button id="createBtn" type="button">Create</button>
          </div>
        </div>
        <table>
          <thead><tr><th>Name</th><th>Kind</th><th>Size</th><th>Provider Version</th><th>Create Time</th><th>Modify Time</th><th>Actions</th></tr></thead>
          <tbody id="rows"></tbody>
        </table>
      </main>
      <aside class="meta">
        <div class="path">Metadata</div>
        <div id="metadata" class="meta-empty">Click an item to inspect metadata.</div>
      </aside>
    </section>
  </div>
  <script>
    let mounts = ${JSON.stringify(
      input.mounts.map((item) => ({
        mountId: item.mountId,
        mountNodeId: item.mountNodeId,
        operations: item.operations,
      })),
    )};
    let statuses = ${JSON.stringify(input.statuses)};
    let selectedPath = mounts[0]?.mountNodeId || "";
    let selectedMountId = mounts[0]?.mountId || "";
    let selectedNodeId = "";
    let currentItems = [];
    let refreshPathTimer = null;

    function formatTime(value) {
      if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
        return "";
      }
      return new Date(value).toLocaleString();
    }

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

    function currentMount() {
      if (selectedMountId) {
        const byId = mounts.find((mount) => mount.mountId === selectedMountId);
        if (byId) return byId;
      }
      return mounts.find((mount) => mount.mountNodeId === selectedPath) || null;
    }

    function can(operation) {
      const mount = currentMount();
      return Boolean(mount && mount.operations && mount.operations[operation]);
    }

    function renderToolbar() {
      const createBtn = document.getElementById("createBtn");
      const createKind = document.getElementById("createKind");
      if (!createBtn) return;
      const enabled = can("create") && Boolean(selectedPath);
      createBtn.style.visibility = enabled ? "visible" : "hidden";
      createBtn.disabled = !enabled;
      if (createKind) {
        createKind.style.visibility = enabled ? "visible" : "hidden";
        createKind.disabled = !enabled;
      }
    }

    function renderMetadata(metadata) {
      const el = document.getElementById("metadata");
      if (!metadata) {
        el.className = "meta-empty";
        el.textContent = "Click an item to inspect metadata.";
        return;
      }
      const pairs = [
        ["nodeId", metadata.nodeId],
        ["mountId", metadata.mountId],
        ["parentId", metadata.parentId],
        ["name", metadata.name],
        ["kind", metadata.kind],
        ["size", metadata.size],
        ["mtimeMs", metadata.mtimeMs],
        ["createTime", formatTime(metadata.createdAtMs)],
        ["modifyTime", formatTime(metadata.updatedAtMs)],
        ["sourceRef", metadata.sourceRef],
        ["providerVersion", metadata.providerVersion],
      ];
      el.className = "";
      el.innerHTML = '<table class="meta-grid"><tbody>' +
        pairs.map(([k, v]) => "<tr><th>" + k + "</th><td>" + (v ?? "") + "</td></tr>").join("") +
        "</tbody></table>";
    }

    async function loadMetadata(nodeId) {
      if (!nodeId) {
        renderMetadata(null);
        return;
      }
      const res = await fetch("/api/metadata?nodeId=" + encodeURIComponent(nodeId));
      if (!res.ok) {
        renderMetadata(null);
        return;
      }
      const payload = await res.json();
      renderMetadata(payload.metadata ?? null);
    }

    function renderRows() {
      const rows = document.getElementById("rows");
      const allowRename = can("rename");
      const allowDelete = can("delete");
      rows.innerHTML = currentItems.map((item) => {
        const active = item.nodeId === selectedNodeId ? " active" : "";
        return "<tr class='row" + active + "' data-node-id='" + item.nodeId + "' data-kind='" + item.kind + "'>" +
          "<td class='name-cell' data-node-id='" + item.nodeId + "' data-name='" + item.name + "'>" + item.name + "</td>" +
          "<td class='kind-" + item.kind + "'>" + item.kind + "</td><td>" + (item.size ?? "") + "</td><td>" + (item.providerVersion ?? "") + "</td><td>" + formatTime(item.createdAtMs) + "</td><td>" + formatTime(item.updatedAtMs) + "</td>" +
          "<td class='actions'>" + (allowDelete ? "<button type='button' data-delete-node-id='" + item.nodeId + "'>Delete</button>" : "") + "</td></tr>";
      }).join("");
      rows.querySelectorAll("td.name-cell").forEach((cell) => {
        cell.addEventListener("dblclick", async (event) => {
          event.stopPropagation();
          if (!allowRename) return;
          const nodeId = cell.getAttribute("data-node-id") || "";
          const currentName = cell.getAttribute("data-name") || "";
          const next = window.prompt("Rename", currentName);
          if (!next || next === currentName) return;
          await renameNode(nodeId, next);
        });
      });
      rows.querySelectorAll("button[data-delete-node-id]").forEach((button) => {
        button.addEventListener("click", async (event) => {
          event.stopPropagation();
          const nodeId = button.getAttribute("data-delete-node-id") || "";
          await deleteNode(nodeId);
        });
      });
      rows.querySelectorAll("tr[data-node-id]").forEach((row) => {
        row.addEventListener("click", async () => {
          selectedNodeId = row.getAttribute("data-node-id") || "";
          renderRows();
          await loadMetadata(selectedNodeId);
        });
        row.addEventListener("dblclick", () => {
          if (row.getAttribute("data-kind") === "folder") {
            const item = currentItems.find((entry) => entry.nodeId === row.getAttribute("data-node-id"));
            if (item?.mountId) {
              selectedMountId = item.mountId;
            }
            loadPath(row.getAttribute("data-node-id"));
          }
        });
      });
    }

    async function createNode() {
      if (!can("create") || !selectedPath) return;
      const createKind = document.getElementById("createKind");
      const kind = createKind && createKind.value === "folder" ? "folder" : "file";
      const typed = window.prompt("Create name (empty = untitled)", "");
      if (typed === null) {
        return;
      }
      const name = typed.trim();
      const res = await fetch("/api/create", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          parentNodeId: selectedPath,
          kind,
          ...(name ? { name } : {}),
        }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "create failed" }));
        window.alert(payload.error || "create failed");
        return;
      }
      await loadPath(selectedPath);
    }

    async function renameNode(nodeId, name) {
      if (!can("rename")) return;
      const res = await fetch("/api/rename", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId, name }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "rename failed" }));
        window.alert(payload.error || "rename failed");
        return;
      }
      await loadPath(selectedPath);
    }

    async function deleteNode(nodeId) {
      if (!can("delete")) return;
      const res = await fetch("/api/delete", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ nodeId }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({ error: "delete failed" }));
        window.alert(payload.error || "delete failed");
        return;
      }
      if (selectedNodeId === nodeId) {
        selectedNodeId = "";
        renderMetadata(null);
      }
      await loadPath(selectedPath);
    }

    async function refreshStateAndMaybePath() {
      const res = await fetch("/api/state");
      if (!res.ok) return;
      const payload = await res.json();
      if (Array.isArray(payload.mounts)) {
        mounts = payload.mounts.map((item) => ({
          mountId: item.mountId,
          mountNodeId: item.mountNodeId,
          operations: item.operations || { create: false, rename: false, delete: false },
        }));
      }
      if (Array.isArray(payload.statuses)) {
        statuses = payload.statuses;
      }
      if (!mounts.some((mount) => mount.mountNodeId === selectedPath)) {
        selectedPath = mounts[0]?.mountNodeId || "";
        selectedMountId = mounts[0]?.mountId || "";
        selectedNodeId = "";
      }
      renderStatus();
      renderMounts();
      renderToolbar();
      if (selectedPath) {
        await loadPath(selectedPath);
      } else {
        currentItems = [];
        renderRows();
        renderMetadata(null);
      }
    }

    function scheduleRefreshPath() {
      if (refreshPathTimer) {
        clearTimeout(refreshPathTimer);
      }
      refreshPathTimer = setTimeout(() => {
        refreshPathTimer = null;
        if (selectedPath) {
          loadPath(selectedPath);
        }
      }, 120);
    }

    async function loadPath(parentNodeId) {
      if (!parentNodeId) return;
      selectedPath = parentNodeId;
      selectedNodeId = "";
      const selectedMount = mounts.find((mount) => mount.mountNodeId === parentNodeId);
      if (selectedMount) {
        selectedMountId = selectedMount.mountId;
      }
      renderMounts();
      renderToolbar();
      document.getElementById("currentPath").textContent = parentNodeId;
      const res = await fetch("/api/list?parentNodeId=" + encodeURIComponent(parentNodeId) + "&limit=200");
      if (!res.ok) {
        currentItems = [];
        renderRows();
        renderMetadata(null);
        return;
      }
      const data = await res.json();
      currentItems = data.items || [];
      if (!selectedMountId && currentItems[0]?.mountId) {
        selectedMountId = currentItems[0].mountId;
      }
      renderRows();
      renderMetadata(null);
    }

    async function start() {
      renderStatus();
      renderMounts();
      renderToolbar();
      const createBtn = document.getElementById("createBtn");
      if (createBtn) {
        createBtn.addEventListener("click", () => {
          void createNode();
        });
      }
      if (selectedPath) {
        await loadPath(selectedPath);
      }
      const events = new EventSource("/api/events");
      events.addEventListener("vfs-change", async (event) => {
        const change = JSON.parse(event.data);
        if (change.parentId === null) {
          await refreshStateAndMaybePath();
          return;
        }
        if (change.id === selectedNodeId) {
          if (change.type === "delete") {
            selectedNodeId = "";
            renderRows();
            renderMetadata(null);
          } else {
            await loadMetadata(selectedNodeId);
          }
        }
        if (change.parentId === selectedPath) {
          scheduleRefreshPath();
        }
      });
      events.addEventListener("init", (event) => {
        const payload = JSON.parse(event.data);
        if (Array.isArray(payload.statuses)) {
          statuses = payload.statuses;
          renderStatus();
        }
      });
    }

    void start();
  </script>
</body>
</html>`;
}
