import { expect, it } from "bun:test";
import renderer from "react-test-renderer";
import { App } from "./App";

it("defaults to chat route and shows knowledge base files", () => {
  const tree = renderer.create(<App />).root;
  const hasText = (text: string) =>
    tree.findAll(
      (node) =>
        node.children.length === 1 &&
        typeof node.children[0] === "string" &&
        node.children[0] === text
    ).length > 0;

  expect(tree.findByProps({ "data-testid": "chat-panel" })).toBeTruthy();
  expect(tree.findByType("h1").children.join("")).toContain("How can I help you today?");
  expect(hasText("Knowledge Base")).toBe(true);
  expect(hasText("Files")).toBe(true);
  expect(tree.findByProps({ "data-testid": "global-status-indicator" })).toBeTruthy();
  expect(tree.findByProps({ "data-testid": "global-vfs-status-indicator" })).toBeTruthy();
  expect(tree.findByProps({ "data-testid": "global-index-status-indicator" })).toBeTruthy();
  expect(tree.findByProps({ "data-testid": "global-vectordb-status-indicator" })).toBeTruthy();
});

it("renders search panel and keeps global status indicator", () => {
  const tree = renderer.create(<App initialRoute="/search" />).root;

  expect(tree.findByProps({ "data-testid": "search-panel" })).toBeTruthy();
  expect(tree.findByProps({ "data-testid": "global-status-indicator" })).toBeTruthy();
});

it("renders files panel when route is /files", () => {
  const tree = renderer.create(<App initialRoute="/files" />).root;

  expect(tree.findByProps({ "data-testid": "files-panel" })).toBeTruthy();
});
