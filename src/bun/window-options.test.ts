import { expect, test } from "bun:test";
import { createMainWindowOptions } from "./window-options";

test("creates main window options with hidden inset title bar", () => {
  const options = createMainWindowOptions({
    rendererUrl: "http://localhost:5173",
  });

  expect(options.title).toBe("Knowdisk");
  expect(options.url).toBe("http://localhost:5173");
  expect(options.titleBarStyle).toBe("hiddenInset");
  expect(options.frame).toEqual({
    width: 1400,
    height: 900,
    x: 120,
    y: 100,
  });
});
