import { extname } from "node:path";
import type { MarkdownConverter } from "./parser.types";

const UNSUPPORTED_VIDEO_EXTENSIONS = new Set([
  ".avi",
  ".flv",
  ".m4v",
  ".mkv",
  ".mov",
  ".mp4",
  ".mpeg",
  ".mpg",
  ".mts",
  ".ts",
  ".webm",
  ".wmv",
]);

export function isParserSupportedFile(input: { name: string; sourceRef?: string | null }): boolean {
  const fileExtension = extname(input.name || input.sourceRef || "").toLowerCase();
  return !UNSUPPORTED_VIDEO_EXTENSIONS.has(fileExtension);
}

type MarkItDownInstance = {
  convertBuffer: (
    buffer: Buffer,
    options: {
      file_extension: string;
    }
  ) => Promise<{ title?: string | null; markdown?: string | null } | null | undefined>;
};

let markItDownPromise: Promise<MarkItDownInstance> | null = null;

async function getMarkItDown(): Promise<MarkItDownInstance> {
  if (!markItDownPromise) {
    markItDownPromise = import("markitdown-ts").then(({ MarkItDown }) => new MarkItDown());
  }
  return markItDownPromise;
}

export const defaultMarkdownConverter: MarkdownConverter = {
  id: "markitdown-ts",
  version: "0.0.10",
  async convert(input) {
    const fileExtension = extname(input.node.name || input.node.sourceRef).toLowerCase();
    if (
      fileExtension === ".md" ||
      fileExtension === ".txt" ||
      fileExtension === ".json" ||
      fileExtension === ".yml" ||
      fileExtension === ".yaml"
    ) {
      return {
        title: null,
        markdown: input.buffer.toString("utf8"),
      };
    }

    const markItDown = await getMarkItDown();
    const result = await markItDown.convertBuffer(input.buffer, {
      file_extension: fileExtension,
    });

    return {
      title: result?.title ?? null,
      markdown: result?.markdown ?? "",
    };
  },
};
