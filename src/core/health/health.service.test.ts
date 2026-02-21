import { expect, test } from "bun:test";
import { createHealthService } from "./health.service";

test("aggregate health becomes degraded when watch backend degrades", () => {
  const svc = createHealthService();
  svc.setComponent("watch", "degraded");
  expect(svc.getAppHealth()).toBe("degraded");
});

test("exposes subsystem status map", () => {
  const svc = createHealthService();
  svc.setComponent("mcp", "failed");
  const components = svc.getComponentHealth();
  expect(components.mcp).toBe("failed");
  expect(components.fs).toBe("healthy");
});
