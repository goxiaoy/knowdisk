import { join } from "node:path";
import type { CreateParserServiceInput, ParserService } from "./parser.types";

export function createParserService(
  input: CreateParserServiceInput,
): ParserService {
  const basePath = input.basePath.trim();
  if (!basePath) {
    throw new Error("basePath is required");
  }

  return {
    parseNode(_parseInput) {
      return emptyChunks();
    },
    async materializeNode(_parseInput) {
      throw new Error("materializeNode is not implemented");
    },
    getCachePaths(cacheInput) {
      return {
        dir: join(basePath, cacheInput.nodeId),
        markdownPath: join(basePath, cacheInput.nodeId, "document.md"),
        manifestPath: join(basePath, cacheInput.nodeId, "manifest.json"),
        errorPath: join(basePath, cacheInput.nodeId, "error.json"),
      };
    },
  };
}

async function* emptyChunks() {
  return;
}
