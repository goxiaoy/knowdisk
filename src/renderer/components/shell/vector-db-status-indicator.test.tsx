import { expect, test } from "bun:test";
import renderer from "react-test-renderer";
import { VectorDbStatusIndicator } from "./vector-db-status-indicator";

test("renders rebuilding vector db progress", () => {
  const tree = renderer.create(
    <VectorDbStatusIndicator
      status={{
        available: true,
        chunkCount: 42,
        lastUpdatedAt: "2026-03-17T16:00:00Z",
        error: "",
      }}
    />
  ).root;

  expect(tree.findByProps({ "data-testid": "global-vectordb-status-indicator" })).toBeTruthy();
  expect(
    tree.findAll(
      (node) => node.children.length > 0 && node.children.every((child) => typeof child === "string")
    ).some((node) => node.children.join("") === "42")
  ).toBe(true);
  expect(
    tree.findAll(
      (node) => node.children.length > 0 && node.children.every((child) => typeof child === "string")
    ).some((node) => node.children.join("").includes("Updated 2026-03-17T16:00:00Z"))
  ).toBe(true);
});
