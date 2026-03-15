import { describe, expect, it } from "bun:test";
import { selectPreferredRepoFiles } from "./model.service";

describe("selectPreferredRepoFiles", () => {
  it("keeps required files and onnx/model.onnx sidecars only", () => {
    const selected = selectPreferredRepoFiles([
      { rfilename: "config.json", size: 10 },
      { rfilename: "tokenizer.json", size: 11 },
      { rfilename: "tokenizer_config.json", size: 12 },
      { rfilename: "special_tokens_map.json", size: 13 },
      { rfilename: "onnx/model.onnx", size: 99 },
      { rfilename: "onnx/model.onnx_data", size: 1234 },
      { rfilename: "onnx/model_int8.onnx", size: 88 },
      { rfilename: "README.md", size: 1 },
    ]);

    expect(selected.map((item) => item.path)).toEqual([
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "special_tokens_map.json",
      "onnx/model.onnx",
      "onnx/model.onnx_data",
    ]);
  });
});
