import { describe, expect, test } from "bun:test";
import { createParserService } from "@knowdisk/parser";

describe("parser package", () => {
  test("exports createParserService", () => {
    expect(typeof createParserService).toBe("function");
  });
});
