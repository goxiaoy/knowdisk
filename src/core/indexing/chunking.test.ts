import { expect, test } from "bun:test";
import { chunkDocument } from "./chunking";

test("produces stable chunk ids for same content", () => {
  const a = chunkDocument({ path: "a.md", text: "hello world" });
  const b = chunkDocument({ path: "a.md", text: "hello world" });
  expect(a[0].chunkId).toBe(b[0].chunkId);
});
