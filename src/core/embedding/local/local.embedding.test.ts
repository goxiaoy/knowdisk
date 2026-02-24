import { expect, test } from "bun:test";
import { embedWithLocalProvider } from "./local.embedding";

test("embeds using local extractor output", async () => {
  const extractor = async () => ({ data: new Float32Array([0.1, 0.2, 0.3]) });
  const vector = await embedWithLocalProvider("hello", extractor);
  expect(vector).toHaveLength(3);
  expect(vector[0]).toBeCloseTo(0.1, 6);
  expect(vector[1]).toBeCloseTo(0.2, 6);
  expect(vector[2]).toBeCloseTo(0.3, 6);
});

test("throws when local extractor returns missing data", async () => {
  const extractor = async () => ({});
  await expect(embedWithLocalProvider("hello", extractor)).rejects.toThrow(
    "local embedding output missing data",
  );
});
