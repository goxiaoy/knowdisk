import type { Parser, ParserMeta } from "./parser.types";
import { textParser } from "./parsers/text.parser";

const markdownParser: Parser = {
  id: "markdown",
  parse(input: string) {
    return { text: input };
  },
};

const unsupportedParser: Parser = {
  id: "unsupported",
  parse() {
    return { text: "", skipped: "UNSUPPORTED_TYPE" };
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
