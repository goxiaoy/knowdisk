import { expect, test } from "bun:test";
import renderer from "react-test-renderer";
import { IndexStatusIndicator } from "./index-status-indicator";

test("renders rebuilding progress and active node details", () => {
  const tree = renderer.create(
    <IndexStatusIndicator
      status={{
        available: true,
        phase: "rebuilding",
        scope: "full",
        queueDepth: 3,
        processedFiles: 12,
        totalFiles: 40,
        activeNodeName: "notes/readme.md",
        error: "",
      }}
    />
  ).root;

  const texts = tree
    .findAll(
      (node) =>
        node.children.length > 0 && node.children.every((child) => typeof child === "string")
    )
    .map((node) => node.children.join(""));

  expect(texts).toContain("Index");
  expect(texts).toContain("12 / 40");
  expect(texts).toContain("notes/readme.md");
});

test("renders queue details while incremental indexing is active", () => {
  const tree = renderer.create(
    <IndexStatusIndicator
      status={{
        available: true,
        phase: "indexing",
        scope: "incremental",
        queueDepth: 3,
        processedFiles: 0,
        totalFiles: 1,
        activeNodeName: "notes/readme.md",
        error: "",
      }}
    />
  ).root;

  const texts = tree
    .findAll(
      (node) =>
        node.children.length > 0 && node.children.every((child) => typeof child === "string")
    )
    .map((node) => node.children.join(""));

  expect(texts).toContain("Indexing (3 queued)");
  expect(texts.some((text) => text.includes("3 jobs remaining"))).toBe(true);
});
