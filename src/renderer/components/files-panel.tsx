import { useCallback, useEffect, useRef, useState } from "react";
import type { FileNodeMetadata, FileTreeNode } from "../../shared/files";
import { FileInfoDialog } from "./files/file-info-dialog";
import { FilesPreview } from "./files/files-preview";
import { FilesTree, ROOT_KEY } from "./files/files-tree";
import type { FilesApi } from "./files/types";

function sortNodes(items: FileTreeNode[]): FileTreeNode[] {
  return [...items].sort((a, b) => {
    if (a.kind !== b.kind) {
      if (a.kind === "mount") return -1;
      if (b.kind === "mount") return 1;
      if (a.kind === "folder") return -1;
      if (b.kind === "folder") return 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function mergeNodes(current: FileTreeNode[], incoming: FileTreeNode[]): FileTreeNode[] {
  const byId = new Map<string, FileTreeNode>();
  for (const node of current) {
    byId.set(node.nodeId, node);
  }
  for (const node of incoming) {
    byId.set(node.nodeId, node);
  }
  return sortNodes([...byId.values()]);
}

export function FilesPanel({ api }: { api: FilesApi }) {
  const [nodesByParent, setNodesByParent] = useState<Record<string, FileTreeNode[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingParents, setLoadingParents] = useState<Record<string, boolean>>({});
  const [nextCursorByParent, setNextCursorByParent] = useState<Record<string, string | null>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<string>("");
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string>("");
  const [infoPanel, setInfoPanel] = useState<{
    nodeName: string;
    metadata: FileNodeMetadata | null;
    error: string;
    loading: boolean;
  } | null>(null);
  const inFlightParentsRef = useRef<Set<string>>(new Set());
  const nextCursorByParentRef = useRef<Record<string, string | null>>({});

  useEffect(() => {
    nextCursorByParentRef.current = nextCursorByParent;
  }, [nextCursorByParent]);

  const loadNodes = useCallback(
    async (parentNodeId: string | null, options?: { reset?: boolean }) => {
      const key = parentNodeId ?? ROOT_KEY;
      if (inFlightParentsRef.current.has(key)) {
        return;
      }
      const shouldReset = options?.reset === true;
      const currentCursor = nextCursorByParentRef.current[key];
      if (!shouldReset && currentCursor === null) {
        return;
      }
      if (!shouldReset && currentCursor === undefined) {
        return;
      }
      inFlightParentsRef.current.add(key);
      setLoadingParents((current) => ({ ...current, [key]: true }));
      try {
        const response = await api.listFilesNodes({
          parentNodeId,
          cursor: shouldReset ? undefined : currentCursor ?? undefined,
          limit: 120,
        });
        setNodesByParent((current) => ({
          ...current,
          [key]: shouldReset
            ? sortNodes(response.items)
            : mergeNodes(current[key] ?? [], response.items),
        }));
        setNextCursorByParent((current) => ({
          ...current,
          [key]: response.nextCursor ?? null,
        }));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        inFlightParentsRef.current.delete(key);
        setLoadingParents((current) => ({ ...current, [key]: false }));
      }
    },
    [api]
  );

  useEffect(() => {
    void loadNodes(null, { reset: true });
  }, [loadNodes]);

  const onToggleNode = useCallback(
    async (node: FileTreeNode) => {
      if (node.kind === "file") {
        setSelectedNodeId(node.nodeId);
        setLoadingPreview(true);
        setError("");
        try {
          const response = await api.getFileMarkdown(node.nodeId);
          if (!response.ok) {
            setPreviewTitle(node.name);
            setPreviewMarkdown(`> Failed to parse file\n\n${response.error}`);
            return;
          }
          setPreviewTitle(response.title ?? node.name);
          setPreviewMarkdown(response.markdown || "(empty markdown)");
        } finally {
          setLoadingPreview(false);
        }
        return;
      }

      const nextExpanded = !expanded[node.nodeId];
      setExpanded((current) => ({ ...current, [node.nodeId]: nextExpanded }));
      if (nextExpanded && !nodesByParent[node.nodeId]) {
        await loadNodes(node.nodeId, { reset: true });
      }
    },
    [api, expanded, loadNodes, nodesByParent]
  );

  const onAddDirectory = useCallback(async () => {
    setError("");
    const picked = await api.pickLocalDirectory();
    if (!picked.ok) {
      setError(picked.error);
      return;
    }
    if (picked.cancelled) {
      return;
    }

    const mounted = await api.mountLocalDirectory(picked.directory);
    if (!mounted.ok) {
      setError(mounted.error);
      return;
    }
    await loadNodes(null, { reset: true });
    setExpanded((current) => ({ ...current, [mounted.mountId]: true }));
    await loadNodes(mounted.mountId, { reset: true });
  }, [api, loadNodes]);

  const onRenameNode = useCallback(
    async (node: FileTreeNode, nextNameInput: string) => {
      const nextName = nextNameInput.trim();
      if (!nextName || nextName === node.name) {
        return;
      }
      setError("");
      const response = await api.renameFileNode({
        nodeId: node.nodeId,
        name: nextName,
      });
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setNodesByParent((current) => {
        const next: Record<string, FileTreeNode[]> = { ...current };
        for (const [parentId, nodes] of Object.entries(current)) {
          if (!nodes.some((item) => item.nodeId === response.node.nodeId)) {
            continue;
          }
          next[parentId] = sortNodes(
            nodes.map((item) => (item.nodeId === response.node.nodeId ? response.node : item))
          );
        }
        return next;
      });
      if (selectedNodeId === node.nodeId) {
        setPreviewTitle((current) => current ?? nextName);
      }
    },
    [api, selectedNodeId]
  );

  const onShowNodeInfo = useCallback(
    async (node: FileTreeNode) => {
      setInfoPanel({
        nodeName: node.name,
        metadata: null,
        error: "",
        loading: true,
      });
      const response = await api.getFileNodeMetadata(node.nodeId);
      if (!response.ok) {
        setInfoPanel({
          nodeName: node.name,
          metadata: null,
          error: response.error,
          loading: false,
        });
        return;
      }
      setInfoPanel({
        nodeName: node.name,
        metadata: response.metadata,
        error: "",
        loading: false,
      });
    },
    [api]
  );

  const onDeleteNode = useCallback(
    async (node: FileTreeNode) => {
      setError("");
      const response = await api.deleteFileNode(node.nodeId);
      if (!response.ok) {
        setError(response.error);
        return;
      }

      if (selectedNodeId === node.nodeId) {
        setSelectedNodeId(null);
        setPreviewTitle(null);
        setPreviewMarkdown("");
      }

      setNodesByParent((current) => {
        const next: Record<string, FileTreeNode[]> = {};
        for (const [parentId, nodes] of Object.entries(current)) {
          next[parentId] = nodes.filter((item) => item.nodeId !== node.nodeId);
        }
        delete next[node.nodeId];
        return next;
      });
      setExpanded((current) => {
        const next = { ...current };
        delete next[node.nodeId];
        return next;
      });

      if (node.kind === "mount" || node.parentId === null) {
        await loadNodes(null, { reset: true });
        return;
      }
      await loadNodes(node.parentId, { reset: true });
    },
    [api, loadNodes, selectedNodeId]
  );

  const rootNodes = nodesByParent[ROOT_KEY] ?? [];

  return (
    <section
      className="relative grid h-full min-h-0 grid-cols-1 gap-4 md:grid-cols-[320px_minmax(0,1fr)]"
      data-testid="files-panel"
    >
      <FilesTree
        expanded={expanded}
        hasMoreByParent={Object.fromEntries(
          Object.entries(nextCursorByParent).map(([key, value]) => [key, value !== null])
        )}
        isRootLoading={Boolean(loadingParents[ROOT_KEY] && (nodesByParent[ROOT_KEY] ?? []).length === 0)}
        isRootLoadingMore={Boolean(loadingParents[ROOT_KEY] && (nodesByParent[ROOT_KEY] ?? []).length > 0)}
        loadingParents={loadingParents}
        nodesByParent={nodesByParent}
        onAddDirectory={() => {
          void onAddDirectory();
        }}
        onDeleteNode={(node) => {
          void onDeleteNode(node);
        }}
        onLoadMore={(parentNodeId) => {
          void loadNodes(parentNodeId, { reset: false });
        }}
        onRenameNode={(node, nextName) => {
          void onRenameNode(node, nextName);
        }}
        onShowNodeInfo={(node) => {
          void onShowNodeInfo(node);
        }}
        onToggleNode={(node) => {
          void onToggleNode(node);
        }}
        rootNodes={rootNodes}
        selectedNodeId={selectedNodeId}
      />
      <FilesPreview
        error={error}
        loadingPreview={loadingPreview}
        previewMarkdown={previewMarkdown}
        previewTitle={previewTitle}
      />
      {infoPanel ? (
        <FileInfoDialog
          error={infoPanel.error}
          loading={infoPanel.loading}
          metadata={infoPanel.metadata}
          nodeName={infoPanel.nodeName}
          onClose={() => setInfoPanel(null)}
        />
      ) : null}
    </section>
  );
}
