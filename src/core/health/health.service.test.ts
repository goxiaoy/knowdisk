import { expect, test } from "bun:test";
import { createHealthService } from "./health.service";

test("aggregate health becomes degraded when watch backend degrades", () => {
  const svc = createHealthService();
  svc.setComponent("watch", "degraded");
  expect(svc.getAppHealth()).toBe("degraded");
});
