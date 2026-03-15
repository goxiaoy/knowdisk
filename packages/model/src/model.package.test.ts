import { describe, expect, it } from "bun:test";
import * as model from "./index";

describe("@knowdisk/model package", () => {
  it("exports the model service factory", () => {
    expect(model).toHaveProperty("createModelService");
  });
});
