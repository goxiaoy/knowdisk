import { describe, expect, test } from "bun:test";
import { createVfsProviderRegistry } from "@knowdisk/vfs";

describe("vfs workspace package", () => {
  test("resolves @knowdisk/vfs exports from workspace", () => {
    const registry = createVfsProviderRegistry();
    expect(registry.listTypes()).toEqual([]);
  });
});
