import { describe, expect, test } from "bun:test";
import { VFS_PROVIDER_OPERATIONS_READY } from "./vfs.provider.types";

describe("vfs operation contracts", () => {
  test("exports provider operation contract sentinel", () => {
    expect(VFS_PROVIDER_OPERATIONS_READY).toBe(true);
  });
});
