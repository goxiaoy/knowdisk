import type { Parser, ParserMeta } from "./parser.types";
import { textParser } from "./parsers/text.parser";

const markdownParser: Parser = {
  id: "markdown",
  parseStream(input) {
    return textParser.parseStream(input);
  },
  readRange(path, startOffset, endOffset) {
    return textParser.readRange(path, startOffset, endOffset);
  },
};

const unsupportedParser: Parser = {
  id: "unsupported",
  async *parseStream() {
    yield {
      text: "",
      startOffset: 0,
      endOffset: 0,
      tokenEstimate: 0,
      skipped: "UNSUPPORTED_TYPE",
    };
  },
  async readRange() {
    throw new Error("UNSUPPORTED_TYPE");
  },
};

export function resolveParser(meta: ParserMeta): Parser {
  if (meta.ext === ".md") {
    return markdownParser;
  }

  if (meta.ext === ".txt" || meta.ext === ".json" || meta.ext === ".yml" || meta.ext === ".yaml") {
    return textParser;
  }

  return unsupportedParser;
}
