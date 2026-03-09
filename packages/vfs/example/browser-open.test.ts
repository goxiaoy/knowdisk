import { describe, expect, test } from "bun:test";
import {
  getOpenBrowserCommand,
  shouldAutoOpenBrowser,
} from "./browser-open";

describe("browser open helper", () => {
  test("returns open command on darwin", () => {
    expect(getOpenBrowserCommand("darwin", "http://127.0.0.1:3099")).toEqual({
      cmd: "open",
      args: ["http://127.0.0.1:3099"],
    });
  });

  test("returns xdg-open command on linux", () => {
    expect(getOpenBrowserCommand("linux", "http://127.0.0.1:3099")).toEqual({
      cmd: "xdg-open",
      args: ["http://127.0.0.1:3099"],
    });
  });

  test("returns start command on win32", () => {
    expect(getOpenBrowserCommand("win32", "http://127.0.0.1:3099")).toEqual({
      cmd: "cmd",
      args: ["/c", "start", "", "http://127.0.0.1:3099"],
    });
  });

  test("returns null for unsupported platform", () => {
    expect(getOpenBrowserCommand("freebsd", "http://127.0.0.1:3099")).toBe(
      null,
    );
  });

  test("auto-open only when tty", () => {
    expect(shouldAutoOpenBrowser(true)).toBe(true);
    expect(shouldAutoOpenBrowser(false)).toBe(false);
  });
});
