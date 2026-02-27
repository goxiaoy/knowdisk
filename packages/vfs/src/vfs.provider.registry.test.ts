import "reflect-metadata";
import { describe, expect, test } from "bun:test";
import { container as rootContainer } from "tsyringe";
import { createVfsProviderRegistry } from "./vfs.provider.registry";
import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsMount } from "./vfs.types";

describe("vfs provider registry", () => {
  test("register/get adapter by providerType", () => {
    const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
    const adapter: VfsProviderAdapter = {
      type: "mock",
      capabilities: { watch: true },
      async listChildren() {
        return { items: [] };
      },
    };
    const mount: VfsMount = {
      mountId: "m1",
      mountPath: "/abc/mock",
      providerType: "mock",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    };

    registry.register("mock", () => adapter);
    expect(registry.get(mount)).toBe(adapter);
    expect(registry.listTypes()).toEqual(["huggingface", "local", "mock"]);
  });

  test("exposes capability flags from code registry", () => {
    const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
    registry.register("drive", () => ({
      type: "drive",
      capabilities: { watch: false },
      async listChildren() {
        return { items: [] };
      },
    }));
    const mount: VfsMount = {
      mountId: "m1",
      mountPath: "/abc/drive",
      providerType: "drive",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    };

    const adapter = registry.get(mount);
    expect(adapter.capabilities.watch).toBe(false);
  });

  test("passes mount into factory and can build mount-scoped adapter", () => {
    const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
    registry.register("drive", (_container, mount) => ({
      type: "drive",
      capabilities: { watch: false },
      async listChildren() {
        return {
          items: [
            {
              sourceRef: mount.mountId,
              parentSourceRef: null,
              name: "x",
              kind: "file",
            },
          ],
        };
      },
    }));
    const mount: VfsMount = {
      mountId: "scoped-id",
      mountPath: "/abc/drive",
      providerType: "drive",
      providerExtra: { token: "t" },
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    };

    const adapter = registry.get(mount);
    expect(adapter.type).toBe("drive");
  });

  test("throws clear error for unknown provider", () => {
    const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
    const mount: VfsMount = {
      mountId: "m1",
      mountPath: "/abc/unknown",
      providerType: "unknown",
      providerExtra: {},
      syncMetadata: true,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    };
    expect(() => registry.get(mount)).toThrow('Unknown VFS provider type: "unknown"');
  });

  test("registers built-in providers from provider directory", async () => {
    const registry = createVfsProviderRegistry(rootContainer.createChildContainer());
    expect(registry.listTypes()).toContain("huggingface");
    expect(registry.listTypes()).toContain("local");

    const mount: VfsMount = {
      mountId: "m-hf",
      mountPath: "/hf",
      providerType: "huggingface",
      providerExtra: { model: "org/repo" },
      syncMetadata: false,
      metadataTtlSec: 60,
      reconcileIntervalMs: 1000,
    };
    const adapter = registry.get(mount);
    expect(adapter.type).toBe("huggingface");
  });
});
