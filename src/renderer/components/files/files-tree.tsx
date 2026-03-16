import { ChevronDown, ChevronRight, FileText, FolderPlus, FolderTree } from "lucide-react";
import { useMemo } from "react";
import type { FileTreeNode } from "../../../shared/files";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const ROOT_KEY = "__root__";

type FilesTreeProps = {
  rootNodes: FileTreeNode[];
  nodesByParent: Record<string, FileTreeNode[]>;
  expanded: Record<string, boolean>;
  selectedNodeId: string | null;
  isRootLoading: boolean;
  onAddDirectory: () => void;
  onToggleNode: (node: FileTreeNode) => void;
};

export function FilesTree({
  rootNodes,
  nodesByParent,
  expanded,
  selectedNodeId,
  isRootLoading,
  onAddDirectory,
  onToggleNode,
}: FilesTreeProps) {
  const tree = useMemo(() => {
    const renderNodes = (nodes: FileTreeNode[], depth: number): JSX.Element[] => {
      return nodes.flatMap((node) => {
        const isBranch = node.kind === "mount" || node.kind === "folder";
        const isOpen = Boolean(expanded[node.nodeId]);
        const children = nodesByParent[node.nodeId] ?? [];

        const row = (
          <button
            key={node.nodeId}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm transition-colors duration-200",
              selectedNodeId === node.nodeId
                ? "bg-slate-100 text-slate-900"
                : "text-slate-600 hover:bg-slate-50 hover:text-slate-900"
            )}
            onClick={() => onToggleNode(node)}
            style={{ paddingLeft: `${8 + depth * 14}px` }}
            type="button"
          >
            {isBranch ? (
              isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />
            ) : (
              <span className="inline-block h-4 w-4" />
            )}
            {node.kind === "file" ? <FileText className="h-4 w-4" /> : <FolderTree className="h-4 w-4" />}
            <span className="truncate">{node.name}</span>
          </button>
        );

        if (!isBranch || !isOpen) {
          return [row];
        }

        return [row, ...renderNodes(children, depth + 1)];
      });
    };

    return renderNodes(rootNodes, 0);
  }, [expanded, nodesByParent, onToggleNode, rootNodes, selectedNodeId]);

  return (
    <Card className="flex h-full flex-col p-3">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm font-semibold uppercase tracking-[0.12em] text-slate-500">Files</p>
        <Button
          className="gap-1.5 rounded-lg"
          onClick={onAddDirectory}
          size="sm"
          variant="outline"
          type="button"
        >
          <FolderPlus className="h-4 w-4" />
          Add
        </Button>
      </div>

      <div className="h-full overflow-auto rounded-xl border border-slate-100 bg-slate-50/40 p-1.5">
        {isRootLoading ? (
          <p className="px-2 py-2 text-sm text-slate-500">Loading files...</p>
        ) : tree.length > 0 ? (
          tree
        ) : (
          <p className="px-2 py-2 text-sm text-slate-500">No mounted directories. Click Add.</p>
        )}
      </div>
    </Card>
  );
}

export { ROOT_KEY };
