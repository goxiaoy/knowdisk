import { expect, test } from "bun:test";
import { resolveContextMenuPosition } from "./files-context-menu";

test("converts viewport coordinates into container-relative menu coordinates", () => {
  expect(
    resolveContextMenuPosition({
      anchor: { x: 520, y: 180 },
      containerRect: { left: 360, top: 100, width: 420, height: 520 },
      menuSize: { width: 140, height: 44 },
    })
  ).toEqual({
    left: 160,
    top: 80,
  });
});

test("clamps menu coordinates so the menu stays inside the container", () => {
  expect(
    resolveContextMenuPosition({
      anchor: { x: 760, y: 580 },
      containerRect: { left: 360, top: 100, width: 420, height: 520 },
      menuSize: { width: 140, height: 44 },
    })
  ).toEqual({
    left: 272,
    top: 468,
  });
});
