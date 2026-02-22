import type { AppConfig, SourceConfig } from "../../core/config/config.types";
import type { ComponentHealth } from "../../core/health/health.service";

type AppBridgeSchema = {
  bun: {
    requests: {
      get_config: { params: void; response: AppConfig };
      update_config: { params: { config: AppConfig }; response: AppConfig };
      add_source: { params: { path: string }; response: SourceConfig[] };
      update_source: { params: { path: string; enabled: boolean }; response: SourceConfig[] };
      remove_source: { params: { path: string }; response: SourceConfig[] };
      get_health: { params: void; response: Record<string, ComponentHealth> };
      pick_source_directory: { params: void; response: string | null };
    };
    messages: {};
  };
  webview: {
    requests: {};
    messages: {};
  };
};

type BridgeRpc = {
  request: {
    get_config: () => Promise<AppConfig>;
    update_config: (params: { config: AppConfig }) => Promise<AppConfig>;
    add_source: (params: { path: string }) => Promise<SourceConfig[]>;
    update_source: (params: { path: string; enabled: boolean }) => Promise<SourceConfig[]>;
    remove_source: (params: { path: string }) => Promise<SourceConfig[]>;
    get_health: () => Promise<Record<string, ComponentHealth>>;
    pick_source_directory: () => Promise<string | null>;
  };
};

let rpc: BridgeRpc | null = null;

async function getRpc() {
  if (rpc) return rpc;
  if (typeof window === "undefined" || !window.__electrobunBunBridge) return null;

  const mod = await import("electrobun/view");
  const next = mod.default.Electroview.defineRPC<AppBridgeSchema>({
    handlers: { requests: {}, messages: {} },
  });
  new mod.default.Electroview({ rpc: next });
  rpc = next as BridgeRpc;
  return next as BridgeRpc;
}

export async function getConfigFromBun(): Promise<AppConfig | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.get_config();
  } catch {
    return null;
  }
}

export async function updateConfigInBun(config: AppConfig): Promise<void> {
  const channel = await getRpc();
  if (!channel) return;
  try {
    await channel.request.update_config({ config });
  } catch {
    return;
  }
}

export async function addSourceInBun(path: string): Promise<SourceConfig[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.add_source({ path });
  } catch (error) {
    console.error("add_source RPC failed:", error);
    return null;
  }
}

export async function updateSourceInBun(path: string, enabled: boolean): Promise<SourceConfig[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.update_source({ path, enabled });
  } catch (error) {
    console.error("update_source RPC failed:", error);
    return null;
  }
}

export async function removeSourceInBun(path: string): Promise<SourceConfig[] | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.remove_source({ path });
  } catch (error) {
    console.error("remove_source RPC failed:", error);
    return null;
  }
}

export async function getHealthFromBun(): Promise<Record<string, ComponentHealth> | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.get_health();
  } catch {
    return null;
  }
}

export async function pickSourceDirectoryFromBun(): Promise<string | null> {
  const channel = await getRpc();
  if (!channel) return null;
  try {
    return await channel.request.pick_source_directory();
  } catch {
    return null;
  }
}
