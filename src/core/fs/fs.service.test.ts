import { describe, expect, test } from "bun:test";
import { normalizeEvent } from "./fs.service";

describe("normalizeEvent", () => {
  test("maps rename to canonical renamed event", () => {
    const event = normalizeEvent("rename", "/tmp/a.txt", "/tmp/b.txt");
    expect(event.type).toBe("renamed");
  });
});
