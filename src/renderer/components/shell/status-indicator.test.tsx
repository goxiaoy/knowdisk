import { expect, test } from "bun:test";
import renderer from "react-test-renderer";
import { StatusIndicator } from "./status-indicator";

function collectTexts(tree: renderer.ReactTestInstance): string[] {
  return tree
    .findAll(
      (node) => node.children.length > 0 && node.children.every((child) => typeof child === "string")
    )
    .map((node) => node.children.join(""));
}

test("renders dynamic model tasks and concrete model names", () => {
  const tree = renderer.create(
    <StatusIndicator
      status={{
        available: true,
        phase: "running",
        progressPct: 37,
        error: "",
        tasks: {
          embedding: {
            id: "embedding-local",
            model: "Alibaba-NLP/gte-multilingual-base",
            state: "ready",
            progressPct: 100,
            error: "",
          },
          reranker: {
            id: "reranker-local",
            model: "Alibaba-NLP/gte-multilingual-reranker-base",
            state: "verifying",
            progressPct: 42,
            error: "",
          },
          ocr: {
            id: "ocr-local",
            model: "PaddlePaddle/PP-OCRv4_mobile",
            state: "downloading",
            progressPct: 12,
            error: "",
          },
          caption: {
            id: "caption-local",
            model: "vikhyatk/moondream2",
            state: "pending",
            progressPct: 0,
            error: "",
          },
        },
      }}
    />
  ).root;

  const texts = collectTexts(tree);

  expect(texts).toContain("Embedding");
  expect(texts).toContain("Reranker");
  expect(texts).toContain("OCR");
  expect(texts).toContain("Caption");
  expect(texts).toContain("Alibaba-NLP/gte-multilingual-base");
  expect(texts).toContain("Alibaba-NLP/gte-multilingual-reranker-base");
  expect(texts).toContain("PaddlePaddle/PP-OCRv4_mobile");
  expect(texts).toContain("vikhyatk/moondream2");
});
