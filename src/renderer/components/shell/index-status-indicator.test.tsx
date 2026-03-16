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
        processedFiles: 12,
        totalFiles: 40,
        activeNodeName: "notes/readme.md",
        error: "",
      }}
    />
  ).root;

  const texts = tree
    .findAll((node) => node.children.length === 1 && typeof node.children[0] === "string")
    .map((node) => node.children[0]);

  expect(texts).toContain("Index");
  expect(texts).toContain("12 / 40");
  expect(texts).toContain("notes/readme.md");
});
