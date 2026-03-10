import { toString } from "mdast-util-to-string";
import { unified } from "unified";
import remarkParse from "remark-parse";

type HeadingNode = {
  type: "heading";
  depth: number;
  children: unknown[];
  position?: {
    start?: { offset?: number };
    end?: { offset?: number };
  };
};

type RootNode = {
  children: Array<HeadingNode | { position?: { start?: { offset?: number }; end?: { offset?: number } } }>;
};

export function splitMarkdownIntoSections(markdown: string) {
  const tree = unified().use(remarkParse).parse(markdown) as RootNode;
  const sections: Array<{
    sectionId: string;
    heading: string | null;
    depth: number | null;
    sectionPath: string[];
    markdown: string;
    text: string;
    charStart: number;
    charEnd: number;
  }> = [];

  const headingIndexes = tree.children
    .map((node, index) => ({ node, index }))
    .filter(
      (entry): entry is { node: HeadingNode; index: number } =>
        entry.node.type === "heading",
    );

  if (headingIndexes.length === 0) {
    const trimmed = markdown.trim();
    if (!trimmed) {
      return sections;
    }
    sections.push({
      sectionId: "section-0",
      heading: null,
      depth: null,
      sectionPath: [],
      markdown: trimmed,
      text: trimmed,
      charStart: 0,
      charEnd: markdown.length,
    });
    return sections;
  }

  const firstHeadingStart = headingIndexes[0].node.position?.start?.offset ?? 0;
  const preamble = markdown.slice(0, firstHeadingStart).trim();
  if (preamble) {
    sections.push({
      sectionId: `section-${sections.length}`,
      heading: null,
      depth: null,
      sectionPath: [],
      markdown: preamble,
      text: preamble,
      charStart: 0,
      charEnd: firstHeadingStart,
    });
  }

  const headingStack: string[] = [];
  const depthStack: number[] = [];
  for (let index = 0; index < headingIndexes.length; index += 1) {
    const current = headingIndexes[index].node;
    const start = current.position?.start?.offset ?? 0;
    const end =
      index + 1 < headingIndexes.length
        ? (headingIndexes[index + 1].node.position?.start?.offset ?? markdown.length)
        : markdown.length;
    const sectionMarkdown = markdown.slice(start, end).trim();
    const heading = toString(current).trim();

    while (
      depthStack.length > 0 &&
      depthStack[depthStack.length - 1] >= current.depth
    ) {
      depthStack.pop();
      headingStack.pop();
    }
    depthStack.push(current.depth);
    headingStack.push(heading);

    sections.push({
      sectionId: `section-${sections.length}`,
      heading,
      depth: current.depth,
      sectionPath: [...headingStack],
      markdown: sectionMarkdown,
      text: sectionMarkdown,
      charStart: start,
      charEnd: end,
    });
  }

  return sections;
}
