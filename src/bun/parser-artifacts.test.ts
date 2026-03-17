import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildParserDocumentPath, deriveMarkdownTitle } from "./parser-artifacts";

describe("parser artifacts", () => {
  test("builds document.md path from parser cache dir and node id", () => {
    expect(
      buildParserDocumentPath({
        parserCacheDir: "/tmp/parser-cache",
        nodeId: "node-1",
      })
    ).toBe(join("/tmp/parser-cache", "node-1", "document.md"));
  });

  test("derives title from first markdown heading", () => {
    expect(deriveMarkdownTitle("# Hello World\n\nBody", "fallback.md")).toBe("Hello World");
    expect(deriveMarkdownTitle("## Nested Heading", "fallback.md")).toBe("Nested Heading");
  });

  test("falls back to file stem when markdown has no heading", () => {
    expect(deriveMarkdownTitle("plain body", "report.final.md")).toBe("report.final");
  });
});
