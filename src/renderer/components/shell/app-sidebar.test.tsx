import { expect, test } from "bun:test";
import renderer from "react-test-renderer";
import { AppSidebar } from "./app-sidebar";

test("renders sidebar with muted shell background and segmented sections", () => {
  const tree = renderer
    .create(
      <AppSidebar
        modelStatus={{
          available: true,
          phase: "idle",
          progressPct: 0,
          error: "",
          tasks: {
            embedding: null,
            reranker: null,
          },
        }}
        indexStatus={{
          available: true,
          phase: "idle",
          scope: null,
          queueDepth: 0,
          processedFiles: 0,
          totalFiles: 0,
          activeNodeName: "",
          error: "",
        }}
        onNavigate={() => {}}
        route="/chat"
        vectorDbStatus={{
          available: true,
          chunkCount: 42,
          lastUpdatedAt: "",
          error: "",
        }}
        vfsStatus={{
          available: true,
          phase: "idle",
          error: "",
          syncingMounts: 0,
          mounts: [],
        }}
      />
    )
    .root;

  const sidebar = tree.findByProps({ "data-testid": "app-sidebar" });
  const primarySection = tree.findByProps({ "data-testid": "app-sidebar-primary" });
  const knowledgeSection = tree.findByProps({ "data-testid": "app-sidebar-knowledge" });
  const statusSection = tree.findByProps({ "data-testid": "app-sidebar-status" });
  const filesButton = tree.findByProps({ "data-testid": "sidebar-files-nav" });
  const statusButtons = statusSection.findAllByType("button").map((node) => node.props["data-testid"]);
  const hasText = (text: string) =>
    tree.findAll(
      (node) =>
        node.children.length === 1 &&
        typeof node.children[0] === "string" &&
        node.children[0] === text
    ).length > 0;

  expect(sidebar.props.className).not.toContain("bg-slate-100/90");
  expect(sidebar.props.className).toContain("p-3");
  expect(sidebar.props.className).not.toContain("shadow-[");
  expect(sidebar.props.className).not.toContain("border ");
  expect(sidebar.props.className).not.toContain("border-slate-");
  expect(primarySection.props.className).not.toContain("bg-white/");
  expect(knowledgeSection.props.className).not.toContain("bg-white/");
  expect(statusSection.props.className).toContain("border-t");
  expect(filesButton.props.children).toHaveLength(2);
  expect(statusButtons).toEqual([
    "global-status-indicator",
    "global-vfs-status-indicator",
    "global-index-status-indicator",
    "global-vectordb-status-indicator",
  ]);
  expect(hasText("KnowDisk")).toBe(true);
  expect(hasText("Desktop workspace")).toBe(true);
});
