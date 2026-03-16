import { expect, test } from "bun:test";
import renderer from "react-test-renderer";
import { VfsStatusIndicator } from "./vfs-status-indicator";

test("renders mount names in cloud sync tooltip", () => {
  const tree = renderer.create(
    <VfsStatusIndicator
      status={{
        available: true,
        phase: "syncing",
        error: "",
        syncingMounts: 1,
        mounts: [
          {
            mountId: "mount-1",
            name: "My Docs",
            phase: "metadata",
            pendingUnits: 6,
            error: "",
          },
        ],
      }}
    />
  ).root;

  expect(tree.findAllByType("span").some((node) => node.children.join("") === "My Docs")).toBe(true);
  expect(tree.findAllByType("span").some((node) => node.children.join("") === "mount-1")).toBe(false);
  expect(
    tree.findAll(
      (node) =>
        node.children.length === 1 &&
        typeof node.children[0] === "string" &&
        node.children[0] === "Cloud Sync"
    ).length
  ).toBeGreaterThan(0);
  expect(
    tree.findAll(
      (node) =>
        node.children.length === 1 &&
        typeof node.children[0] === "string" &&
        node.children[0] === "6 items pending"
    ).length
  ).toBeGreaterThan(0);
});
