import { describe, expect, test } from "bun:test";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsProviderAdapter } from "./vfs.provider.types";

describe("vfs provider registry", () => {
  test("register/get adapter by providerType", () => {
    const registry = createVfsProviderRegistry();
    const adapter: VfsProviderAdapter = {
      type: "mock",
      capabilities: { watch: true },
      async listChildren() {
        return { items: [] };
      },
    };

    registry.register(adapter);
    expect(registry.get("mock")).toBe(adapter);
    expect(registry.listTypes()).toEqual(["mock"]);
  });

  test("exposes capability flags from code registry", () => {
    const registry = createVfsProviderRegistry();
    registry.register({
      type: "drive",
      capabilities: { watch: false },
      async listChildren() {
        return { items: [] };
      },
    });

    const adapter = registry.get("drive");
    expect(adapter.capabilities.watch).toBe(false);
  });

  test("throws clear error for unknown provider", () => {
    const registry = createVfsProviderRegistry();
    expect(() => registry.get("unknown")).toThrow('Unknown VFS provider type: "unknown"');
  });
});
