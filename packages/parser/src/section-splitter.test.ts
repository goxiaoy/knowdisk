import { describe, expect, test } from "bun:test";
import { splitMarkdownIntoSections } from "./section-splitter";

describe("section splitter", () => {
  test("creates a preamble section before the first heading", () => {
    const sections = splitMarkdownIntoSections(
      "Intro paragraph\n\n# Heading One\n\nBody text\n",
    );

    expect(sections).toHaveLength(2);
    expect(sections[0]).toMatchObject({
      heading: null,
      depth: null,
      sectionPath: [],
      text: "Intro paragraph",
    });
    expect(sections[1]).toMatchObject({
      heading: "Heading One",
      depth: 1,
      sectionPath: ["Heading One"],
      text: "# Heading One\n\nBody text",
    });
  });

  test("builds sectionPath from nested headings", () => {
    const sections = splitMarkdownIntoSections(
      "# Intro\n\nAlpha\n\n## Install\n\nBeta\n\n## Usage\n\nGamma\n\n# API\n\nDelta\n",
    );

    expect(sections.map((section) => section.sectionPath)).toEqual([
      ["Intro"],
      ["Intro", "Install"],
      ["Intro", "Usage"],
      ["API"],
    ]);
    expect(sections.map((section) => section.heading)).toEqual([
      "Intro",
      "Install",
      "Usage",
      "API",
    ]);
  });
});
