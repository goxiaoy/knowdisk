type BrowserCommand = {
  cmd: string;
  args: string[];
};

export function shouldAutoOpenBrowser(isTTY: boolean | undefined): boolean {
  return isTTY === true;
}

export function getOpenBrowserCommand(
  platform: NodeJS.Platform,
  url: string,
): BrowserCommand | null {
  if (platform === "darwin") {
    return { cmd: "open", args: [url] };
  }
  if (platform === "linux") {
    return { cmd: "xdg-open", args: [url] };
  }
  if (platform === "win32") {
    return { cmd: "cmd", args: ["/c", "start", "", url] };
  }
  return null;
}

export function tryOpenBrowser(url: string): void {
  const command = getOpenBrowserCommand(process.platform, url);
  if (!command) {
    return;
  }
  try {
    Bun.spawn({
      cmd: [command.cmd, ...command.args],
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`Failed to auto-open browser: ${message}`);
  }
}
