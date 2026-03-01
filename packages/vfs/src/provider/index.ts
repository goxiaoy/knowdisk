import type { VfsProviderRegistry } from "../vfs.provider.registry";
import type { DependencyContainer } from "tsyringe";
import type { Logger } from "pino";
import { createHuggingFaceVfsProvider } from "./huggingface";
import { createLocalVfsProvider } from "./local";

export function registerBuiltinVfsProviders(registry: VfsProviderRegistry): void {
  registry.register("huggingface", (container, mount) =>
    createHuggingFaceVfsProvider(mount, { logger: resolveLogger(container) }),
  );
  registry.register("local", (container, mount) =>
    createLocalVfsProvider(mount, { logger: resolveLogger(container) }),
  );
}

export * from "./huggingface";
export * from "./local";

function resolveLogger(container: DependencyContainer): Logger | undefined {
  if (!container.isRegistered("logger", true)) {
    return undefined;
  }
  return container.resolve<Logger>("logger");
}
