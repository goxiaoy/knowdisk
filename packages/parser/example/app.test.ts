import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { PassThrough } from "node:stream";
import { createParserExampleApp, runParserExample } from "./app";

describe("parser example", () => {
  test("exports createParserExampleApp", () => {
    expect(typeof createParserExampleApp).toBe("function");
    expect(typeof runParserExample).toBe("function");
  });

  test("creates runtime directories and a stop handle", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "parser-example-"));
    try {
      const app = await createParserExampleApp({
        runtimeRoot,
        startSyncOnBoot: false,
      });

      expect(app.runtimeRoot).toBe(runtimeRoot);
      expect(typeof app.stop).toBe("function");
      expect(app.paths.dbPath).toBe(join(runtimeRoot, "vfs.db"));
      expect(app.paths.parserCacheDir).toBe(join(runtimeRoot, "parser-cache"));
      expect(app.paths.contentDir).toBe(join(runtimeRoot, "content"));

      await app.stop();
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("mounts local example data through vfs", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "parser-example-"));
    try {
      const app = await createParserExampleApp({
        runtimeRoot,
        startSyncOnBoot: false,
      });

      expect(app.mounts).toHaveLength(1);
      expect(app.mounts[0]?.providerType).toBe("local");
      expect(app.dataDir.endsWith("packages/parser/example/data")).toBe(true);

      await app.stop();
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("prints parse output when afterUpdateContent fires", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "parser-example-"));
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on("data", (chunk) => {
      chunks.push(chunk.toString());
    });

    try {
      const app = await createParserExampleApp({
        runtimeRoot,
        stream,
      });

      await app.waitForIdle();

      expect(chunks.some((line) => line.includes("[PARSE]"))).toBe(true);
      expect(chunks.some((line) => line.includes("[CHUNK]"))).toBe(true);
      expect(
        chunks.some(
          (line) =>
            line.includes("sourceRef=hello.md") &&
            line.includes("[PARSE]"),
        ),
      ).toBe(true);
      expect(
        chunks.some(
          (line) =>
            line.includes("status=ok") && line.includes("Hello Parser"),
        ),
      ).toBe(true);
      expect(
        chunks.some(
          (line) =>
            (line.includes("sourceRef=image.png") ||
              line.includes("sourceRef=paper.pdf")) &&
            line.includes("[PARSE]"),
        ),
      ).toBe(true);
      expect(
        chunks.some(
          (line) =>
            line.includes("status=error") || line.includes("status=skipped"),
        ),
      ).toBe(true);

      await app.stop();
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("runParserExample writes parse output to the provided stream", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "parser-example-"));
    const stream = new PassThrough();
    const chunks: string[] = [];
    stream.on("data", (chunk) => {
      chunks.push(chunk.toString());
    });

    try {
      await runParserExample({
        runtimeRoot,
        stream,
      });

      expect(chunks.some((line) => line.includes("[PARSE]"))).toBe(true);
      expect(chunks.some((line) => line.includes("[CHUNK]"))).toBe(true);
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});
