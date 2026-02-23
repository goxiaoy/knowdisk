import { join } from "node:path";

type UpsertOptions = {
  endpoint: string;
};

type ClaudeDesktopConfig = {
  mcpServers?: Record<string, { command?: string; args?: string[] }>;
  [key: string]: unknown;
};

export function pickClaudeDesktopConfigPath(input: {
  homeDir: string;
  platform: NodeJS.Platform;
}): string {
  if (input.platform === "darwin") {
    return join(
      input.homeDir,
      "Library",
      "Application Support",
      "Claude",
      "claude_desktop_config.json",
    );
  }
  if (input.platform === "win32") {
    const appData = process.env.APPDATA;
    if (appData && appData.length > 0) {
      return join(appData, "Claude", "claude_desktop_config.json");
    }
  }
  return join(
    input.homeDir,
    ".config",
    "Claude",
    "claude_desktop_config.json",
  );
}

export function upsertKnowDiskMcpServerConfig(
  raw: string,
  options: UpsertOptions,
): ClaudeDesktopConfig {
  const parsed = parseConfig(raw);
  const current = parsed.mcpServers ?? {};
  return {
    ...parsed,
    mcpServers: {
      ...current,
      knowdisk: {
        command: "npx",
        args: ["-y", "mcp-remote", options.endpoint],
      },
    },
  };
}

function parseConfig(raw: string): ClaudeDesktopConfig {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {};
  }
  const parsed = JSON.parse(trimmed) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return parsed as ClaudeDesktopConfig;
}
