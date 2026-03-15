import { describe, expect, it } from "bun:test";
import * as model from "./index";
import * as typesModule from "./model.service.types";
import type { ModelService } from "./model.service.types";

describe("ModelService types", () => {
  it("supports separate embedding and reranker redownload APIs", () => {
    expect(model).toHaveProperty("createModelService");

    const service: Pick<
      ModelService,
      "redownloadEmbeddingModel" | "redownloadRerankerModel"
    > = {
      redownloadEmbeddingModel: async () => ({ ok: true }),
      redownloadRerankerModel: async () => ({ ok: true }),
    };

    expect(typesModule).toBeObject();
    expect(service.redownloadEmbeddingModel).toBeFunction();
    expect(service.redownloadRerankerModel).toBeFunction();
  });
});
