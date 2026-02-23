import { describe, expect, test } from "bun:test";
import {
  pickClaudeDesktopConfigPath,
  upsertKnowDiskMcpServerConfig,
} from "./claude-desktop-config";

describe("claude desktop config helpers", () => {
  test("upsertKnowDiskMcpServerConfig creates knowdisk entry with mcp-remote", () => {
    const next = upsertKnowDiskMcpServerConfig("{}", {
      endpoint: "http://127.0.0.1:3467/mcp",
    });
    expect(next.mcpServers.knowdisk).toEqual({
      command: "npx",
      args: ["-y", "mcp-remote", "http://127.0.0.1:3467/mcp"],
    });
  });

  test("upsertKnowDiskMcpServerConfig preserves existing servers", () => {
    const next = upsertKnowDiskMcpServerConfig(
      JSON.stringify({
        mcpServers: {
          filesystem: {
            command: "npx",
            args: ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
          },
        },
      }),
      { endpoint: "http://127.0.0.1:3467/mcp" },
    );

    expect(next.mcpServers.filesystem).toBeDefined();
    expect(next.mcpServers.knowdisk).toBeDefined();
  });

  test("pickClaudeDesktopConfigPath uses macOS location", () => {
    const path = pickClaudeDesktopConfigPath({
      homeDir: "/Users/goxy",
      platform: "darwin",
    });
    expect(path).toBe("/Users/goxy/Library/Application Support/Claude/claude_desktop_config.json");
  });
});
