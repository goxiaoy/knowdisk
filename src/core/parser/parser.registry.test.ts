import { expect, test } from "bun:test";
import { resolveParser } from "./parser.registry";

test("routes .md files to markdown parser", () => {
  const parser = resolveParser({ ext: ".md", mime: "text/markdown" });
  expect(parser.id).toBe("markdown");
});

test("returns unsupported for .pdf in v1", () => {
  const parser = resolveParser({ ext: ".pdf", mime: "application/pdf" });
  expect(parser.id).toBe("unsupported");
});
