import { extname } from "node:path";
import { MarkItDown } from "markitdown-ts";
import type { MarkdownConverter } from "./parser.types";

const markItDown = new MarkItDown();

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

    const result = await markItDown.convertBuffer(input.buffer, {
      file_extension: fileExtension,
    });

    return {
      title: result?.title ?? null,
      markdown: result?.markdown ?? "",
    };
  },
};
