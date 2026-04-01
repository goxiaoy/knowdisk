import { describe, expect, test } from "bun:test";
import { decodeVfsCursorToken, encodeVfsLocalCursorToken } from "./vfs.cursor";

describe("vfs cursor codec", () => {
  test("encode/decode local cursor {lastName,lastNodeId}", () => {
    const token = encodeVfsLocalCursorToken({ lastName: "a.md", lastNodeId: "n3" });
    const decoded = decodeVfsCursorToken(token);
    expect(decoded).toEqual({ mode: "local", lastName: "a.md", lastNodeId: "n3" });
  });

  test("rejects malformed token", () => {
    expect(() => decodeVfsCursorToken("not-base64")).toThrow("Invalid VFS cursor token");
  });
});
