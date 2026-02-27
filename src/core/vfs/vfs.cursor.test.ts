import { describe, expect, test } from "bun:test";
import {
  decodeVfsCursorToken,
  encodeVfsLocalCursorToken,
  encodeVfsRemoteCursorToken,
} from "./vfs.cursor";

describe("vfs cursor codec", () => {
  test("encode/decode local cursor {lastName,lastNodeId}", () => {
    const token = encodeVfsLocalCursorToken({ lastName: "a.md", lastNodeId: "n3" });
    const decoded = decodeVfsCursorToken(token);
    expect(decoded).toEqual({ mode: "local", lastName: "a.md", lastNodeId: "n3" });
  });

  test("encode/decode remote cursor {providerCursor}", () => {
    const token = encodeVfsRemoteCursorToken({ providerCursor: "next-page-token" });
    const decoded = decodeVfsCursorToken(token);
    expect(decoded).toEqual({ mode: "remote", providerCursor: "next-page-token" });
  });

  test("rejects malformed token", () => {
    expect(() => decodeVfsCursorToken("not-base64")).toThrow("Invalid VFS cursor token");
  });
});
