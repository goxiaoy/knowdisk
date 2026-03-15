import { describe, expect, it } from "bun:test";
import {
  createEmbeddingRegistry,
  createIndexingService,
  createRerankerRegistry,
} from "@knowdisk/indexing";

describe("indexing package", () => {
  it("exports the package factories", () => {
    expect(createIndexingService).toBeFunction();
    expect(createEmbeddingRegistry).toBeFunction();
    expect(createRerankerRegistry).toBeFunction();
  });
});
