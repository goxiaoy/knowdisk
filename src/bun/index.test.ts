import { expect, it } from "bun:test";
import { createWindowOptions } from "./index";

it("returns renderer-backed window options", () => {
	expect(createWindowOptions().url).toContain("index.html");
});
