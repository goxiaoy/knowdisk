import type { VfsProviderAdapter } from "./vfs.provider.types";

export type VfsProviderRegistry = {
  register: (adapter: VfsProviderAdapter) => void;
  get: (providerType: string) => VfsProviderAdapter;
  listTypes: () => string[];
};

export function createVfsProviderRegistry(): VfsProviderRegistry {
  const adapters = new Map<string, VfsProviderAdapter>();

  return {
    register(adapter: VfsProviderAdapter) {
      adapters.set(adapter.type, adapter);
    },

    get(providerType: string) {
      const adapter = adapters.get(providerType);
      if (!adapter) {
        throw new Error(`Unknown VFS provider type: "${providerType}"`);
      }
      return adapter;
    },

    listTypes() {
      return [...adapters.keys()].sort();
    },
  };
}
