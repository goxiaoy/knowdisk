import { useCallback, useEffect, useState } from "react";
import type { FileTreeNode } from "../../shared/files";
import { FilesPreview } from "./files/files-preview";
import { FilesTree, ROOT_KEY } from "./files/files-tree";
import type { FilesApi } from "./files/types";

export function FilesPanel({ api }: { api: FilesApi }) {
  const [nodesByParent, setNodesByParent] = useState<Record<string, FileTreeNode[]>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [loadingParents, setLoadingParents] = useState<Record<string, boolean>>({});
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [previewMarkdown, setPreviewMarkdown] = useState<string>("");
  const [previewTitle, setPreviewTitle] = useState<string | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState<string>("");

  const loadNodes = useCallback(
    async (parentNodeId: string | null) => {
      const key = parentNodeId ?? ROOT_KEY;
      setLoadingParents((current) => ({ ...current, [key]: true }));
      try {
        const response = await api.listFilesNodes(parentNodeId);
        setNodesByParent((current) => ({
          ...current,
          [key]: response.items.sort((a, b) => {
            if (a.kind !== b.kind) {
              if (a.kind === "mount") return -1;
              if (b.kind === "mount") return 1;
              if (a.kind === "folder") return -1;
              if (b.kind === "folder") return 1;
            }
            return a.name.localeCompare(b.name);
          }),
        }));
      } catch (loadError) {
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      } finally {
        setLoadingParents((current) => ({ ...current, [key]: false }));
      }
    },
    [api]
  );

  useEffect(() => {
    void loadNodes(null);
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
        await loadNodes(node.nodeId);
      }
    },
    [api, expanded, loadNodes, nodesByParent]
  );

  const onAddDirectory = useCallback(async () => {
    setError("");
    const response = await api.pickAndMountLocalDirectory();
    if (!response.ok) {
      setError(response.error);
      return;
    }
    if (response.cancelled) {
      return;
    }
    await loadNodes(null);
    setExpanded((current) => ({ ...current, [response.mountId]: true }));
    await loadNodes(response.mountId);
  }, [api, loadNodes]);

  const rootNodes = nodesByParent[ROOT_KEY] ?? [];

  return (
    <section
      className="grid h-full min-h-[560px] grid-cols-1 gap-4 md:grid-cols-[320px_minmax(0,1fr)]"
      data-testid="files-panel"
    >
      <FilesTree
        expanded={expanded}
        isRootLoading={Boolean(loadingParents[ROOT_KEY])}
        nodesByParent={nodesByParent}
        onAddDirectory={() => {
          void onAddDirectory();
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
    </section>
  );
}
