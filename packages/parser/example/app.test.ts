import { describe, expect, test } from "bun:test";
import { access, cp, mkdtemp, readFile, readdir, rm, unlink, writeFile } from "node:fs/promises";
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
      expect(app.paths.parserChunksDir).toBe(join(runtimeRoot, "parser-chunks"));
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
      expect(chunks.some((line) => line.includes("[CHUNK]") && line.includes("status=ok"))).toBe(
        true
      );
      expect(
        chunks.some(
          (line) =>
            (line.includes("sourceRef=info.json") ||
              line.includes("sourceRef=image.png") ||
              line.includes("sourceRef=paper.pdf")) &&
            line.includes("[PARSE]")
        )
      ).toBe(true);
      expect(
        chunks.some((line) => line.includes("status=error") || line.includes("status=skipped"))
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
      const app = await runParserExample({
        runtimeRoot,
        stream,
      });

      expect(typeof app.stop).toBe("function");
      await app.waitForIdle();
      expect(chunks.some((line) => line.includes("[PARSE]"))).toBe(true);
      expect(chunks.some((line) => line.includes("[CHUNK]"))).toBe(true);

      await app.stop();
    } finally {
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("writes parse chunks into parser-chunks and replaces previous node output", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "parser-example-"));
    const dataDir = await copyExampleData();
    try {
      const app = await createParserExampleApp({
        runtimeRoot,
        dataDir,
      });

      await app.waitForIdle();

      const outputFiles = await readdir(app.paths.parserChunksDir);
      expect(outputFiles.length).toBeGreaterThan(0);

      const infoNode = app.repository.listNodesByMountIdAndSourceRef(
        app.mounts[0]!.mountId,
        "info.json"
      );
      if (!infoNode) {
        throw new Error("expected info.json node");
      }

      const outputPath = join(app.paths.parserChunksDir, `${infoNode.nodeId}.json`);
      const initialOutput = JSON.parse(await readFile(outputPath, "utf8"));
      expect(initialOutput.nodeId).toBe(infoNode.nodeId);
      expect(initialOutput.sourceRef).toBe("info.json");
      expect(Array.isArray(initialOutput.chunks)).toBe(true);
      expect(initialOutput.chunks.length).toBeGreaterThan(0);

      await writeFile(outputPath, '{"stale":true}', "utf8");
      await app.parseNodeToFile(infoNode.nodeId);

      const refreshedOutput = JSON.parse(await readFile(outputPath, "utf8"));
      expect(refreshedOutput.stale).toBeUndefined();
      expect(refreshedOutput.nodeId).toBe(infoNode.nodeId);
      expect(refreshedOutput.sourceRef).toBe("info.json");
      expect(
        refreshedOutput.chunks.some((chunk: { status: string }) => chunk.status === "ok")
      ).toBe(true);

      await app.stop();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });

  test("afterDelete clears parser cache and parser chunk output", async () => {
    const runtimeRoot = await mkdtemp(join(tmpdir(), "parser-example-"));
    const dataDir = await copyExampleData();
    try {
      const app = await createParserExampleApp({
        runtimeRoot,
        dataDir,
      });

      await app.waitForIdle();

      const infoNode = app.repository.listNodesByMountIdAndSourceRef(
        app.mounts[0]!.mountId,
        "info.json"
      );
      if (!infoNode) {
        throw new Error("expected info.json node");
      }

      const outputPath = join(app.paths.parserChunksDir, `${infoNode.nodeId}.json`);
      const cachePaths = app.parser.getCachePaths({ nodeId: infoNode.nodeId });

      await access(outputPath);
      await access(cachePaths.dir);

      await unlink(join(app.dataDir, "info.json"));
      await app.vfs.triggerReconcile(app.mounts[0]!.mountId);
      await app.waitForIdle();

      await expect(access(outputPath)).rejects.toThrow();
      await expect(access(cachePaths.dir)).rejects.toThrow();

      await app.stop();
    } finally {
      await rm(dataDir, { recursive: true, force: true });
      await rm(runtimeRoot, { recursive: true, force: true });
    }
  });
});

async function copyExampleData() {
  const dir = await mkdtemp(join(tmpdir(), "parser-example-data-"));
  await cp(join(import.meta.dir, "data"), dir, { recursive: true });
  return dir;
}
