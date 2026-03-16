import { expect, mock, test } from "bun:test";
import renderer, { act } from "react-test-renderer";
import type { FileTreeNode } from "../../../shared/files";
import { FilesTree } from "./files-tree";

const rootNodes: FileTreeNode[] = [
  {
    nodeId: "file-1",
    parentId: null,
    name: "notes.md",
    kind: "file",
  },
];

test("context menu show info emits the selected node", async () => {
  const onShowNodeInfo = mock(() => {});
  const onDeleteNode = mock(() => {});
  const tree = renderer.create(
    <FilesTree
      expanded={{}}
      hasMoreByParent={{}}
      isRootLoading={false}
      isRootLoadingMore={false}
      loadingParents={{}}
      nodesByParent={{}}
      onAddDirectory={() => {}}
      onLoadMore={() => {}}
      onDeleteNode={onDeleteNode}
      onRenameNode={() => {}}
      onShowNodeInfo={onShowNodeInfo}
      onToggleNode={() => {}}
      rootNodes={rootNodes}
      selectedNodeId={null}
    />
  );

  const row = tree.root.findAll(
    (node) => typeof node.props.onContextMenu === "function" && node.props.role === "button"
  )[0];

  await act(async () => {
    row.props.onContextMenu({
      preventDefault() {},
      clientX: 120,
      clientY: 120,
    });
  });

  const showInfoButton = tree.root.findAllByType("button").find((node) => {
    const children = node.props.children;
    if (typeof children === "string") {
      return children === "Show Info";
    }
    return Array.isArray(children) && children.some((child) => child === "Show Info");
  });

  expect(showInfoButton).toBeTruthy();

  await act(async () => {
    showInfoButton!.props.onClick();
  });

  expect(onShowNodeInfo).toHaveBeenCalledTimes(1);
  expect(onShowNodeInfo).toHaveBeenCalledWith(rootNodes[0]);
  expect(onDeleteNode).toHaveBeenCalledTimes(0);
});

test("context menu delete asks for confirmation before deleting", async () => {
  const onDeleteNode = mock(() => {});
  const tree = renderer.create(
    <FilesTree
      expanded={{}}
      hasMoreByParent={{}}
      isRootLoading={false}
      isRootLoadingMore={false}
      loadingParents={{}}
      nodesByParent={{}}
      onAddDirectory={() => {}}
      onDeleteNode={onDeleteNode}
      onLoadMore={() => {}}
      onRenameNode={() => {}}
      onShowNodeInfo={() => {}}
      onToggleNode={() => {}}
      rootNodes={rootNodes}
      selectedNodeId={null}
    />
  );

  const row = tree.root.findAll(
    (node) => typeof node.props.onContextMenu === "function" && node.props.role === "button"
  )[0];

  await act(async () => {
    row.props.onContextMenu({
      preventDefault() {},
      clientX: 120,
      clientY: 120,
    });
  });

  const deleteButton = tree.root.findAllByType("button").find((node) => {
    const children = node.props.children;
    if (typeof children === "string") {
      return children === "Delete";
    }
    return Array.isArray(children) && children.some((child) => child === "Delete");
  });

  expect(deleteButton).toBeTruthy();

  await act(async () => {
    deleteButton!.props.onClick();
  });

  expect(tree.root.findByProps({ "data-testid": "files-delete-confirm" })).toBeTruthy();
  expect(onDeleteNode).toHaveBeenCalledTimes(0);
});
