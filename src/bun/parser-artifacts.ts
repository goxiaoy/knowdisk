import { basename, extname, join } from "node:path";

export function buildParserDocumentPath(input: {
  basePath: string;
  nodeId: string;
}): string {
  return join(input.basePath, "parser", input.nodeId, "document.md");
}

export function deriveMarkdownTitle(markdown: string, fallbackName: string): string | null {
  const heading = markdown.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/m)?.[1]?.trim();
  if (heading) {
    return heading;
  }

  const stem = basename(fallbackName, extname(fallbackName)).trim();
  return stem || null;
}
