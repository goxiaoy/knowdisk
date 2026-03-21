import type { VfsProviderRegistry } from "../vfs.provider.registry";
import type { DependencyContainer } from "tsyringe";
import type { Logger } from "pino";
import { createLocalVfsProvider } from "./local";

export function registerBuiltinVfsProviders(registry: VfsProviderRegistry): void {
  registry.register("local", (container, mount) =>
    createLocalVfsProvider(mount, { logger: resolveLogger(container) })
  );
}

export * from "./local";

function resolveLogger(container: DependencyContainer): Logger | undefined {
  if (container.isRegistered("LoggerService", true)) {
    return container.resolve<Logger>("LoggerService");
  }
  return undefined;
}
