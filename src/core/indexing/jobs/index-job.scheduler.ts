import type { IndexJobType } from "../metadata/index-metadata.repository.types";
import type {
  FileEventType,
  IndexJobScheduler,
  JobSink,
  PendingPathJob,
} from "./index-job.scheduler.types";

export function createIndexJobScheduler(
  sink: JobSink,
  opts: { debounceMs: number },
): IndexJobScheduler {
  const pendingByPath = new Map<string, PendingPathJob>();

  return {
    onFsEvent(path: string, eventType: FileEventType, nowMs = Date.now()) {
      const current = pendingByPath.get(path);
      const mapped = mapEventToJob(eventType);

      const jobType: IndexJobType =
        current?.jobType === "delete" ? "delete" : mapped.jobType;
      const reason = jobType === "delete" ? "watcher_unlink" : mapped.reason;

      pendingByPath.set(path, {
        path,
        jobType,
        reason,
        dueAtMs: nowMs + opts.debounceMs,
      });
    },

    flushDue(nowMs = Date.now()) {
      let flushed = 0;
      for (const [path, pending] of pendingByPath.entries()) {
        if (pending.dueAtMs > nowMs) {
          continue;
        }
        sink.enqueueJob({
          jobId: globalThis.crypto.randomUUID(),
          path,
          jobType: pending.jobType,
          reason: pending.reason,
          nextRunAtMs: nowMs,
        });
        pendingByPath.delete(path);
        flushed += 1;
      }
      return flushed;
    },

    pendingCount() {
      return pendingByPath.size;
    },
  };
}

function mapEventToJob(eventType: FileEventType): {
  jobType: IndexJobType;
  reason: string;
} {
  switch (eventType) {
    case "add":
      return { jobType: "index", reason: "watcher_add" };
    case "change":
      return { jobType: "index", reason: "watcher_change" };
    case "unlink":
      return { jobType: "delete", reason: "watcher_unlink" };
  }
}
