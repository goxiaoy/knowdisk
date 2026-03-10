import "reflect-metadata";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { container as rootContainer } from "tsyringe";
import { createParserService, type ParseChunk } from "../src";
import {
  createVfsProviderRegistry,
  createVfsRepository,
  createVfsService,
} from "@knowdisk/vfs";
import { createParserExampleLogger } from "./logger";

const exampleDir = dirname(fileURLToPath(import.meta.url));

export async function createParserExampleApp(input?: {
  runtimeRoot?: string;
  startSyncOnBoot?: boolean;
  stream?: NodeJS.WritableStream;
}) {
  const runtimeRoot =
    input?.runtimeRoot ?? join(process.cwd(), ".parser-example");
  const paths = {
    dbPath: join(runtimeRoot, "vfs.db"),
    parserCacheDir: join(runtimeRoot, "parser-cache"),
    parserChunksDir: join(runtimeRoot, "parser-chunks"),
    contentDir: join(runtimeRoot, "content"),
  };

  await mkdir(paths.parserCacheDir, { recursive: true });
  await mkdir(paths.parserChunksDir, { recursive: true });
  await mkdir(paths.contentDir, { recursive: true });

  const exampleLogger = createParserExampleLogger({ stream: input?.stream });
  const dataDir = join(exampleDir, "data");
  const repository = createVfsRepository({ dbPath: paths.dbPath });
  const container = rootContainer.createChildContainer();
  container.register("logger", { useValue: exampleLogger.logger });
  const registry = createVfsProviderRegistry(container);
  const vfs = createVfsService({
    repository,
    registry,
    contentRootParent: paths.contentDir,
    logger: exampleLogger.logger,
  });
  const parser = createParserService({
    vfs,
    basePath: paths.parserCacheDir,
    logger: exampleLogger.logger,
  });

  const writeChunksForNode = async (input: {
    nodeId: string;
    sourceRef: string;
    providerVersion: string | null;
  }) => {
    const outputPath = join(paths.parserChunksDir, `${input.nodeId}.json`);
    const chunks: ParseChunk[] = [];

    exampleLogger.writeLine(
      `[PARSE] sourceRef=${input.sourceRef} nodeId=${input.nodeId} providerVersion=${input.providerVersion ?? "null"}`,
    );
    for await (const chunk of parser.parseNode({
      nodeId: input.nodeId,
    })) {
      chunks.push(chunk);
      exampleLogger.writeLine(formatChunk(chunk));
      lastActivityAt = Date.now();
    }

    await writeFile(outputPath, "", "utf8");
    await writeFile(
      outputPath,
      JSON.stringify(
        {
          nodeId: input.nodeId,
          sourceRef: input.sourceRef,
          providerVersion: input.providerVersion,
          parsedAt: new Date().toISOString(),
          chunks,
        },
        null,
        2,
      ),
      "utf8",
    );
  };

  let pendingParses = 0;
  let lastActivityAt = Date.now();
  const offHooks = vfs.registerNodeEventHooks({
    async afterUpdateContent(ctx) {
      if (ctx.nextNode?.kind !== "file") {
        return;
      }
      pendingParses += 1;
      lastActivityAt = Date.now();
      try {
        await writeChunksForNode({
          nodeId: ctx.nextNode.nodeId,
          sourceRef: ctx.nextNode.sourceRef,
          providerVersion: ctx.nextNode.providerVersion,
        });
      } finally {
        pendingParses -= 1;
        lastActivityAt = Date.now();
      }
    },
  });

  const mount = await vfs.mountInternal("parser-example-local", {
    providerType: "local",
    providerExtra: { directory: dataDir },
    syncMetadata: true,
    syncContent: true,
    metadataTtlSec: 30,
    reconcileIntervalMs: 600_000,
  });

  if (input?.startSyncOnBoot !== false) {
    await vfs.start();
    exampleLogger.logger.info({}, "parser example bootstrap ready");
  }

  return {
    runtimeRoot,
    paths,
    dataDir,
    mounts: [mount],
    vfs,
    repository,
    logger: exampleLogger.logger,
    async parseNodeToFile(nodeId: string) {
      const node = repository.getNodeById(nodeId);
      if (!node) {
        throw new Error(`node not found: ${nodeId}`);
      }
      if (node.kind !== "file") {
        throw new Error(`node is not a file: ${nodeId}`);
      }
      pendingParses += 1;
      lastActivityAt = Date.now();
      try {
        await writeChunksForNode({
          nodeId: node.nodeId,
          sourceRef: node.sourceRef,
          providerVersion: node.providerVersion,
        });
      } finally {
        pendingParses -= 1;
        lastActivityAt = Date.now();
      }
    },
    async waitForIdle() {
      const deadline = Date.now() + 10_000;
      while (Date.now() < deadline) {
        if (pendingParses === 0 && Date.now() - lastActivityAt > 250) {
          return;
        }
        await Bun.sleep(50);
      }
      throw new Error("parser example did not become idle");
    },
    async stop() {
      offHooks();
      await vfs.close();
      repository.close();
    },
  };
}

export async function runParserExample(input?: {
  runtimeRoot?: string;
  stream?: NodeJS.WritableStream;
}) {
  const app = await createParserExampleApp({
    runtimeRoot: input?.runtimeRoot,
    stream: input?.stream,
  });
  return app;
}

function formatChunk(chunk: ParseChunk): string {
  const preview =
    chunk.text.length > 60 ? `${chunk.text.slice(0, 60)}...` : chunk.text;
  return [
    "[CHUNK]",
    `status=${chunk.status}`,
    `index=${chunk.chunkIndex}`,
    `heading=${JSON.stringify(chunk.heading)}`,
    `tokens=${chunk.tokenEstimate ?? "null"}`,
    `code=${chunk.error?.code ?? "null"}`,
    `message=${JSON.stringify(chunk.error?.message ?? null)}`,
    `text=${JSON.stringify(preview)}`,
  ].join(" ");
}

if (import.meta.main) {
  await runParserExample();
}
