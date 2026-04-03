import { expect, test } from "bun:test";
import { formatFileNodeMetadataEntries } from "./files-info-format";
import type { FileNodeMetadata } from "../../../shared/files";

const metadata: FileNodeMetadata = {
  nodeId: "file-1",
  mountId: "mount-1",
  mountNodeId: "mount-node-1",
  parentId: null,
  name: "notes.md",
  kind: "file",
  type: "file",
  origin: "provider",
  size: 1536,
  mtimeMs: 1_710_000_000_000,
  sourceRef: "docs/notes.md",
  providerVersion: "v1",
  deletedAtMs: null,
  createdAtMs: 1_709_000_000_000,
  updatedAtMs: 1_711_000_000_000,
};

test("formats metadata labels and values for display", () => {
  const entries = formatFileNodeMetadataEntries(metadata);

  expect(entries.find((entry) => entry.key === "size")).toMatchObject({
    label: "Size",
    value: "1.5 KB",
  });
  expect(entries.find((entry) => entry.key === "parentId")).toMatchObject({
    label: "Parent ID",
    value: "—",
  });
  expect(entries.find((entry) => entry.key === "mtimeMs")).toMatchObject({
    label: "Modified",
  });
  expect(entries.find((entry) => entry.key === "providerVersion")).toMatchObject({
    label: "Provider Version",
    value: "v1",
  });
  expect(entries.find((entry) => entry.key === "origin")).toMatchObject({
    label: "Origin",
    value: "provider",
  });
});
