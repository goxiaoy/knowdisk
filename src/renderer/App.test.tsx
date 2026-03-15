import { expect, it } from "bun:test";
import renderer from "react-test-renderer";
import { App } from "./App";

it("shows the application title and placeholder cards", () => {
  const tree = renderer.create(<App />).root;

  expect(tree.findByProps({ "data-testid": "app-title" }).children).toContain("KnowDisk");
  expect(tree.findAllByProps({ "data-testid": "status-card" }).length).toBe(6);
});
