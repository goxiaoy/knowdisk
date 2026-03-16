import { expect, test } from "bun:test";
import renderer from "react-test-renderer";
import { AppShell } from "./app-shell";
import { FALLBACK_MODEL_STATUS } from "../../../shared/model-status";
import { FALLBACK_VECTOR_DB_STATUS } from "../../../shared/vector-db-status";
import { FALLBACK_VFS_STATUS } from "../../../shared/vfs-status";

test("app shell keeps the viewport fixed and relies on internal scrolling", () => {
  const tree = renderer.create(
    <AppShell
      filesApi={{
        listFilesNodes: async () => ({ items: [] }),
        pickLocalDirectory: async () => ({ ok: true, cancelled: true }),
        mountLocalDirectory: async () => ({ ok: true, mountId: "mount-1" }),
        getFileMarkdown: async () => ({ ok: true, markdown: "", title: null }),
        getFileNodeMetadata: async () => ({ ok: false, error: "not implemented" }),
        deleteFileNode: async () => ({ ok: true }),
        renameFileNode: async () => ({
          ok: true,
          node: { nodeId: "n1", parentId: null, name: "demo", kind: "file" },
        }),
      }}
      modelStatus={FALLBACK_MODEL_STATUS}
      onNavigate={() => {}}
      route="/files"
      vfsStatus={FALLBACK_VFS_STATUS}
      vectorDbStatus={FALLBACK_VECTOR_DB_STATUS}
    />
  ).root;

  const topLevel = tree.findAllByType("div")[0];
  expect(topLevel.props.className).toContain("h-screen");
  expect(topLevel.props.className).toContain("overflow-hidden");
  expect(topLevel.props.className).toContain("#f8fafc");

  const cards = tree.findAll((node) => typeof node.props.className === "string" && node.props.className.includes("rounded-3xl"));
  expect(cards.some((node) => String(node.props.className).includes("h-full min-h-0"))).toBe(true);
});

test("app shell lets sidebar overlays escape and stack above the main panel", () => {
  const tree = renderer.create(
    <AppShell
      filesApi={{
        listFilesNodes: async () => ({ items: [] }),
        pickLocalDirectory: async () => ({ ok: true, cancelled: true }),
        mountLocalDirectory: async () => ({ ok: true, mountId: "mount-1" }),
        getFileMarkdown: async () => ({ ok: true, markdown: "", title: null }),
        getFileNodeMetadata: async () => ({ ok: false, error: "not implemented" }),
        deleteFileNode: async () => ({ ok: true }),
        renameFileNode: async () => ({
          ok: true,
          node: { nodeId: "n1", parentId: null, name: "demo", kind: "file" },
        }),
      }}
      modelStatus={FALLBACK_MODEL_STATUS}
      onNavigate={() => {}}
      route="/chat"
      vfsStatus={FALLBACK_VFS_STATUS}
      vectorDbStatus={FALLBACK_VECTOR_DB_STATUS}
    />
  ).root;

  const sidebar = tree.findByProps({ "data-testid": "app-sidebar" });
  const statusSection = tree.findByProps({ "data-testid": "app-sidebar-status" });

  expect(String(sidebar.props.className)).toContain("overflow-visible");
  expect(String(sidebar.props.className)).toContain("z-10");
  expect(String(statusSection.props.className)).toContain("relative");
});

test("app shell keeps a fixed sidebar width and lets the main panel fill remaining space", () => {
  const tree = renderer.create(
    <AppShell
      filesApi={{
        listFilesNodes: async () => ({ items: [] }),
        pickLocalDirectory: async () => ({ ok: true, cancelled: true }),
        mountLocalDirectory: async () => ({ ok: true, mountId: "mount-1" }),
        getFileMarkdown: async () => ({ ok: true, markdown: "", title: null }),
        getFileNodeMetadata: async () => ({ ok: false, error: "not implemented" }),
        deleteFileNode: async () => ({ ok: true }),
        renameFileNode: async () => ({
          ok: true,
          node: { nodeId: "n1", parentId: null, name: "demo", kind: "file" },
        }),
      }}
      modelStatus={FALLBACK_MODEL_STATUS}
      onNavigate={() => {}}
      route="/chat"
      vfsStatus={FALLBACK_VFS_STATUS}
      vectorDbStatus={FALLBACK_VECTOR_DB_STATUS}
    />
  ).root;

  const grid = tree.findAll(
    (node) =>
      typeof node.props.className === "string" &&
      node.props.className.includes("grid-cols-[240px_minmax(0,1fr)]")
  )[0];

  expect(grid).toBeTruthy();
  expect(String(grid.props.className)).toContain("w-full");
  expect(String(grid.props.className)).toContain("max-w-none");
});
