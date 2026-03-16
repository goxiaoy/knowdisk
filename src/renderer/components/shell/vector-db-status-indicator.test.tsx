import { expect, test } from "bun:test";
import renderer from "react-test-renderer";
import { VectorDbStatusIndicator } from "./vector-db-status-indicator";

test("renders rebuilding vector db progress", () => {
  const tree = renderer.create(
    <VectorDbStatusIndicator
      status={{
        available: true,
        chunkCount: 42,
      }}
    />
  ).root;

  expect(tree.findByProps({ "data-testid": "global-vectordb-status-indicator" })).toBeTruthy();
  expect(tree.findAllByType("span").some((node) => node.children.join("") === "42")).toBe(true);
});
