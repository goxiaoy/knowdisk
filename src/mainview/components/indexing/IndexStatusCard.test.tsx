import { describe, expect, test } from "bun:test";
import { act, create } from "react-test-renderer";
import { IndexStatusCard } from "./IndexStatusCard";

describe("IndexStatusCard", () => {
  test("renders queue and reconcile metrics from status payload", async () => {
    const renderer = create(
      <IndexStatusCard
        pollMs={60_000}
        loadStatus={async () => ({
          run: {
            phase: "running",
            reason: "manual",
            startedAt: "2026-02-23T00:00:00.000Z",
            finishedAt: "",
            lastReconcileAt: "2026-02-23T00:10:00.000Z",
            indexedFiles: 12,
            errors: ["/docs/b.md: parse error"],
          },
          scheduler: {
            phase: "draining",
            queueDepth: 3,
          },
          worker: {
            phase: "indexing",
            runningWorkers: 1,
            currentFiles: ["/docs/a.md"],
            lastError: "",
          },
        })}
      />,
    );

    await act(async () => {
      await Promise.resolve();
    });

    const root = renderer.root;
    expect(root.findByProps({ "data-testid": "index-status-reason" }).children.join("")).toContain("manual");
    expect(root.findByProps({ "data-testid": "index-status-indexed-files" }).children.join("")).toContain("12");
    expect(root.findByProps({ "data-testid": "index-status-queue-depth" }).children.join("")).toContain("3");
    expect(root.findByProps({ "data-testid": "index-status-running-workers" }).children.join("")).toContain("1");
    expect(root.findByProps({ "data-testid": "index-status-scheduler-phase" }).children.join("")).toContain("draining");
    expect(root.findByProps({ "data-testid": "index-status-worker-phase" }).children.join("")).toContain("indexing");
    expect(root.findByProps({ "data-testid": "index-status-last-reconcile-at" }).children.join("")).toContain("2026-02-23T00:10:00.000Z");
  });
});
