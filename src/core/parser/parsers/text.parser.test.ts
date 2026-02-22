import { expect, test } from "bun:test";
import { textParser } from "./text.parser";

test("text parser supports simple streaming chunk split", async () => {
  const chunks: Array<{ text: string; startOffset: number; endOffset: number; tokenEstimate: number }> = [];
  async function* input() {
    yield "a".repeat(3000);
    yield "b".repeat(3000);
  }

  for await (const parsed of textParser.parseStream(input())) {
    chunks.push(parsed);
  }

  expect(chunks.length).toBe(2);
  expect(chunks[0]?.text.length).toBe(4000);
  expect(chunks[0]?.startOffset).toBe(0);
  expect(chunks[0]?.endOffset).toBe(4000);
  expect(chunks[0]?.tokenEstimate).toBe(1000);
  expect(chunks[1]?.text.length).toBe(2000);
  expect(chunks[1]?.startOffset).toBe(4000);
  expect(chunks[1]?.endOffset).toBe(6000);
  expect(chunks[1]?.tokenEstimate).toBe(500);
});
