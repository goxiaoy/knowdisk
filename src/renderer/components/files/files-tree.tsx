import { ChevronDown, ChevronRight, FileText, FolderPlus, FolderTree } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { FileTreeNode } from "../../../shared/files";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { resolveContextMenuPosition } from "./files-context-menu";

const ROOT_KEY = "__root__";

type FilesTreeProps = {
  rootNodes: FileTreeNode[];
  nodesByParent: Record<string, FileTreeNode[]>;
  loadingParents: Record<string, boolean>;
  hasMoreByParent: Record<string, boolean>;
  expanded: Record<string, boolean>;
  selectedNodeId: string | null;
  isRootLoading: boolean;
  isRootLoadingMore: boolean;
  onAddDirectory: () => void;
  onDeleteNode: (node: FileTreeNode) => void;
  onLoadMore: (parentNodeId: string | null) => void;
  onRenameNode: (node: FileTreeNode, nextName: string) => void;
  onShowNodeInfo: (node: FileTreeNode) => void;
  onToggleNode: (node: FileTreeNode) => void;
};

export function FilesTree({
  rootNodes,
  nodesByParent,
  loadingParents,
  hasMoreByParent,
  expanded,
  selectedNodeId,
  isRootLoading,
  isRootLoadingMore,
  onAddDirectory,
  onDeleteNode,
  onLoadMore,
  onRenameNode,
  onShowNodeInfo,
  onToggleNode,
}: FilesTreeProps) {
  const [contextMenu, setContextMenu] = useState<{
    node: FileTreeNode;
    left: number;
    top: number;
  } | null>(null);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState("");
  const [deleteConfirmNode, setDeleteConfirmNode] = useState<FileTreeNode | null>(null);
  const editInputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!contextMenu || typeof window === "undefined") {
      return;
    }
      const close = () => {
        setContextMenu(null);
      };
    window.addEventListener("click", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [contextMenu]);

  useEffect(() => {
    if (!editingNodeId || !editInputRef.current) {
      return;
    }
    editInputRef.current.focus();
    editInputRef.current.select();
  }, [editingNodeId]);

  const tree = useMemo(() => {
    const renderNodes = (nodes: FileTreeNode[], depth: number): JSX.Element[] => {
      return nodes.flatMap((node) => {
        const isBranch = node.kind === "mount" || node.kind === "folder";
        const isOpen = Boolean(expanded[node.nodeId]);
        const children = nodesByParent[node.nodeId] ?? [];
        const showLoadMore = isBranch && isOpen && Boolean(hasMoreByParent[node.nodeId]);
        const isLoadingMore = Boolean(loadingParents[node.nodeId]);
        const isEditing = editingNodeId === node.nodeId;
        const isLongLabel = node.name.length > 28;

        const row = (
          <div
            key={node.nodeId}
            className={cn(
              "filetree-row group flex h-12 w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-200",
              selectedNodeId === node.nodeId
                ? "bg-slate-100 text-slate-900"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
            onClick={() => {
              if (!isEditing) {
                onToggleNode(node);
              }
            }}
            onContextMenu={(event) => {
              event.preventDefault();
              const container = containerRef.current;
              const position = container
                ? resolveContextMenuPosition({
                    anchor: { x: event.clientX, y: event.clientY },
                    containerRect: container.getBoundingClientRect(),
                    menuSize: { width: 160, height: 80 },
                  })
                : { left: event.clientX, top: event.clientY };
              setContextMenu({
                node,
                left: position.left,
                top: position.top,
              });
            }}
            role="button"
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            tabIndex={0}
            onKeyDown={(event) => {
              if (isEditing) {
                return;
              }
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                onToggleNode(node);
              }
            }}
          >
            {isBranch ? (
              isOpen ? (
                <ChevronDown className="h-4 w-4 flex-none" />
              ) : (
                <ChevronRight className="h-4 w-4 flex-none" />
              )
            ) : (
              <span className="inline-block h-4 w-4 flex-none" />
            )}
            {node.kind === "file" ? (
              <FileText className="h-4 w-4 flex-none" />
            ) : (
              <FolderTree className="h-4 w-4 flex-none" />
            )}
            {isEditing ? (
              <input
                ref={editInputRef}
                className="w-full min-w-0 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-sm text-slate-800 outline-none focus:border-slate-400"
                onBlur={() => {
                  const nextName = editingValue.trim();
                  if (nextName && nextName !== node.name) {
                    onRenameNode(node, nextName);
                  }
                  setEditingNodeId(null);
                  setEditingValue("");
                }}
                onChange={(event) => setEditingValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    setEditingNodeId(null);
                    setEditingValue("");
                    return;
                  }
                  if (event.key === "Enter") {
                    event.preventDefault();
                    const nextName = editingValue.trim();
                    if (nextName && nextName !== node.name) {
                      onRenameNode(node, nextName);
                    }
                    setEditingNodeId(null);
                    setEditingValue("");
                  }
                }}
                value={editingValue}
              />
            ) : (
              <div className="min-w-0 flex-1 overflow-hidden">
                {isLongLabel ? (
                  <div className="filetree-marquee-wrap">
                    <div className="filetree-marquee-track">
                      <span className="filetree-marquee-text">{node.name}</span>
                      <span aria-hidden="true" className="filetree-marquee-text filetree-marquee-ghost">
                        {node.name}
                      </span>
                    </div>
                  </div>
                ) : (
                  <span className="block truncate">{node.name}</span>
                )}
              </div>
            )}
          </div>
        );

        if (!isBranch || !isOpen) {
          return [row];
        }

        const items = [row, ...renderNodes(children, depth + 1)];
        if (showLoadMore) {
          items.push(
            <button
              key={`${node.nodeId}:more`}
              className="w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
              onClick={() => onLoadMore(node.nodeId)}
              style={{ paddingLeft: `${8 + (depth + 1) * 14}px` }}
              type="button"
            >
              {isLoadingMore ? "Loading..." : "Load more"}
            </button>
          );
        }
        return items;
      });
    };

    return renderNodes(rootNodes, 0);
  }, [
    expanded,
    hasMoreByParent,
    loadingParents,
    nodesByParent,
    onLoadMore,
    onRenameNode,
    onToggleNode,
    rootNodes,
    selectedNodeId,
    editingNodeId,
    editingValue,
  ]);

  return (
    <div ref={containerRef} className="relative flex h-full min-h-0 flex-col">
      <Card className="flex h-full min-h-0 flex-col p-3">
      <div className="app-drag electrobun-webkit-app-region-drag mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Files</p>
        <Button
          className="app-no-drag gap-1.5 rounded-lg"
          onClick={onAddDirectory}
          size="sm"
          variant="outline"
          type="button"
        >
          <FolderPlus className="h-4 w-4" />
          Add
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-slate-100 bg-slate-50/40 p-1.5">
        {isRootLoading ? (
          <p className="px-2 py-2 text-sm text-slate-500">Loading files...</p>
        ) : tree.length > 0 ? (
          <>
            {tree}
            {hasMoreByParent[ROOT_KEY] ? (
              <button
                className="mt-1 w-full cursor-pointer rounded-lg px-2 py-1.5 text-left text-xs text-slate-500 hover:bg-slate-50 hover:text-slate-700"
                onClick={() => onLoadMore(null)}
                type="button"
              >
                {isRootLoadingMore ? "Loading..." : "Load more"}
              </button>
            ) : null}
          </>
        ) : (
          <p className="px-2 py-2 text-sm text-slate-500">No mounted directories. Click Add.</p>
        )}
      </div>
      </Card>

      {contextMenu ? (
        <div
          className="absolute z-50 min-w-[160px] rounded-lg border border-slate-200 bg-white p-1 shadow-[0_8px_24px_rgba(15,23,42,0.16)]"
          style={{ left: `${contextMenu.left}px`, top: `${contextMenu.top}px` }}
        >
          <button
            className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => {
              onShowNodeInfo(contextMenu.node);
              setContextMenu(null);
            }}
            type="button"
          >
            Show Info
          </button>
          <button
            className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm text-rose-600 hover:bg-rose-50"
            onClick={() => {
              setDeleteConfirmNode(contextMenu.node);
              setContextMenu(null);
            }}
            type="button"
          >
            Delete
          </button>
          <button
            className="w-full cursor-pointer rounded-md px-2 py-1.5 text-left text-sm text-slate-700 hover:bg-slate-100"
            onClick={() => {
              setEditingNodeId(contextMenu.node.nodeId);
              setEditingValue(contextMenu.node.name);
              setContextMenu(null);
            }}
            type="button"
          >
            Rename
          </button>
        </div>
      ) : null}
      {deleteConfirmNode ? (
        <div
          className="absolute inset-3 z-40 flex items-start justify-center bg-white/35 px-3 py-6 backdrop-blur-[2px]"
          onClick={() => setDeleteConfirmNode(null)}
        >
          <div
            className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_28px_rgba(15,23,42,0.14)]"
            data-testid="files-delete-confirm"
            onClick={(event) => event.stopPropagation()}
          >
            <p className="text-sm font-semibold text-slate-900">Delete this item?</p>
            <p className="mt-1 text-sm text-slate-500">
              {deleteConfirmNode.kind === "mount"
                ? "This will unmount the directory from KnowDisk."
                : "This will permanently delete the file or folder from the provider."}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button
                className="rounded-md px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
                onClick={() => setDeleteConfirmNode(null)}
                type="button"
              >
                Cancel
              </button>
              <button
                className="rounded-md bg-rose-600 px-3 py-1.5 text-sm text-white hover:bg-rose-700"
                onClick={() => {
                  onDeleteNode(deleteConfirmNode);
                  setDeleteConfirmNode(null);
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export { ROOT_KEY };
