import { expect, test } from "bun:test";
import {
  resolveRangeNotSatisfiableStrategy,
  selectPreferredRepoFiles,
} from "./model-download.service";

test("resolveRangeNotSatisfiableStrategy promotes partial when offsets match", () => {
  expect(resolveRangeNotSatisfiableStrategy(1024, 1024)).toBe("promote_partial");
});

test("resolveRangeNotSatisfiableStrategy restarts when partial is larger", () => {
  expect(resolveRangeNotSatisfiableStrategy(2048, 1024)).toBe("restart");
});

test("resolveRangeNotSatisfiableStrategy restarts when remote size is unknown", () => {
  expect(resolveRangeNotSatisfiableStrategy(1024, 0)).toBe("restart");
});

test("selectPreferredRepoFiles keeps only required tokenizer/config and onnx/model.onnx", () => {
  const selected = selectPreferredRepoFiles([
    { rfilename: "config.json", size: 10 },
    { rfilename: "tokenizer.json", size: 11 },
    { rfilename: "tokenizer_config.json", size: 12 },
    { rfilename: "special_tokens_map.json", size: 13 },
    { rfilename: "onnx/model.onnx", size: 99 },
    { rfilename: "onnx/model_int8.onnx", size: 88 },
    { rfilename: "onnx/model_q4.onnx", size: 77 },
    { rfilename: "README.md", size: 1 },
  ]);
  expect(selected.map((item) => item.path)).toEqual([
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "onnx/model.onnx",
  ]);
});
