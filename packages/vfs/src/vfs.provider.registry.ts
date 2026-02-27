import type { VfsProviderAdapter } from "./vfs.provider.types";
import type { VfsMount } from "./vfs.types";
import type { DependencyContainer } from "tsyringe";

export type VfsProviderAdapterFactory = (
  container: DependencyContainer,
  mount: VfsMount,
) => VfsProviderAdapter;

export type VfsProviderRegistry = {
  register: (providerType: string, factory: VfsProviderAdapterFactory) => void;
  get: (mount: VfsMount) => VfsProviderAdapter;
  listTypes: () => string[];
};

export function createVfsProviderRegistry(
  container: DependencyContainer,
): VfsProviderRegistry {
  const factories = new Map<string, VfsProviderAdapterFactory>();

  return {
    register(providerType: string, factory: VfsProviderAdapterFactory) {
      factories.set(providerType, factory);
    },

    get(mount: VfsMount) {
      const factory = factories.get(mount.providerType);
      if (!factory) {
        throw new Error(`Unknown VFS provider type: "${mount.providerType}"`);
      }
      return factory(container, mount);
    },

    listTypes() {
      return [...factories.keys()].sort();
    },
  };
}
