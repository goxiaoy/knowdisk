import type { VfsProviderRegistry } from "../vfs.provider.registry";
import { createHuggingFaceVfsProvider } from "./huggingface";
import { createLocalVfsProvider } from "./local";

export function registerBuiltinVfsProviders(registry: VfsProviderRegistry): void {
  registry.register("huggingface", (_container, mount) =>
    createHuggingFaceVfsProvider(mount),
  );
  registry.register("local", (_container, mount) => createLocalVfsProvider(mount));
}

export * from "./huggingface";
export * from "./local";
