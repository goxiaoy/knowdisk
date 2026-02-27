import { describe, expect, test } from "bun:test";
import { VFS_PROVIDER_OPERATIONS_READY } from "./vfs.provider.types";
import { VFS_OPERATION_SERVICE_READY } from "./vfs.service.types";

describe("vfs operation contracts", () => {
  test("exports provider and service operation contract sentinels", () => {
    expect(VFS_PROVIDER_OPERATIONS_READY).toBe(true);
    expect(VFS_OPERATION_SERVICE_READY).toBe(true);
  });
});
