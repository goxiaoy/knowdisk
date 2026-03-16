import { expect, mock, test } from "bun:test";
import renderer, { act } from "react-test-renderer";
import { FilesPanel } from "./files-panel";

function createApi() {
  return {
    listFilesNodes: mock(async () => ({
      items: [{ nodeId: "n1", parentId: null, name: "x.md", kind: "file" as const }],
    })),
    pickLocalDirectory: mock(async () => ({ ok: true as const, cancelled: false as const, directory: "/tmp/demo" })),
    mountLocalDirectory: mock(async () => ({ ok: true as const, mountId: "mount-1" })),
    getFileMarkdown: mock(async () => ({ ok: true as const, markdown: "# Demo", title: "Demo" })),
    getFileNodeMetadata: mock(async () => ({
      ok: true as const,
      metadata: {
        nodeId: "n1",
        mountId: "mount-1",
        parentId: null,
        name: "x",
        kind: "file" as const,
        size: 1,
        mtimeMs: 1,
        sourceRef: "docs/x",
        providerVersion: "v1",
        deletedAtMs: null,
        createdAtMs: 1,
        updatedAtMs: 1,
      },
    })),
    deleteFileNode: mock(async () => ({ ok: true as const })),
    renameFileNode: mock(async () => ({ ok: true as const, node: { nodeId: "n1", parentId: null, name: "x", kind: "file" as const } })),
  };
}

test("add directory picks first and mounts only after selection", async () => {
  const api = createApi();
  const tree = renderer.create(<FilesPanel api={api} />);

  const addButton = tree.root.findAllByType("button").find((node) => {
    const children = node.props.children;
    return Array.isArray(children) && children.some((child) => child === "Add");
  });

  expect(addButton).toBeTruthy();

  await act(async () => {
    addButton!.props.onClick();
  });

  expect(api.pickLocalDirectory).toHaveBeenCalledTimes(1);
  expect(api.mountLocalDirectory).toHaveBeenCalledTimes(1);
  expect(api.mountLocalDirectory).toHaveBeenCalledWith("/tmp/demo");
});

test("add directory does not mount when selection is cancelled", async () => {
  const api = createApi();
  api.pickLocalDirectory = mock(async () => ({ ok: true as const, cancelled: true as const }));

  const tree = renderer.create(<FilesPanel api={api} />);
  const addButton = tree.root.findAllByType("button").find((node) => {
    const children = node.props.children;
    return Array.isArray(children) && children.some((child) => child === "Add");
  });

  expect(addButton).toBeTruthy();

  await act(async () => {
    addButton!.props.onClick();
  });

  expect(api.pickLocalDirectory).toHaveBeenCalledTimes(1);
  expect(api.mountLocalDirectory).toHaveBeenCalledTimes(0);
});

test("show info opens a files-panel level dialog with metadata", async () => {
  const api = createApi();
  const tree = renderer.create(<FilesPanel api={api} />);

  await act(async () => {
    await Promise.resolve();
  });

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

  expect(api.getFileNodeMetadata).toHaveBeenCalledTimes(1);
  expect(api.getFileNodeMetadata).toHaveBeenCalledWith("n1");
  expect(tree.root.findByProps({ "data-testid": "files-info-panel" })).toBeTruthy();
});

test("delete confirms before removing a node", async () => {
  const api = createApi();
  const tree = renderer.create(<FilesPanel api={api} />);

  await act(async () => {
    await Promise.resolve();
  });

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

  const confirmButton = tree.root.findAllByType("button").find((node) => {
    const children = node.props.children;
    if (typeof children === "string") {
      return children === "Delete";
    }
    return Array.isArray(children) && children.some((child) => child === "Delete");
  });

  expect(tree.root.findByProps({ "data-testid": "files-delete-confirm" })).toBeTruthy();

  await act(async () => {
    confirmButton!.props.onClick();
  });

  expect(api.deleteFileNode).toHaveBeenCalledTimes(1);
  expect(api.deleteFileNode).toHaveBeenCalledWith("n1");
});
