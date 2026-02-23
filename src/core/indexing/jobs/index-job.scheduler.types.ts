import type { IndexJobType, NewIndexJob } from "../metadata/index-metadata.repository.types";

export type FileEventType = "add" | "change" | "unlink";

export type JobSink = {
  enqueueJob: (job: NewIndexJob) => void;
};

export type IndexJobScheduler = {
  onFsEvent: (path: string, eventType: FileEventType, nowMs?: number) => void;
  flushDue: (nowMs?: number) => number;
  pendingCount: () => number;
};

export type PendingPathJob = {
  path: string;
  jobType: IndexJobType;
  reason: string;
  dueAtMs: number;
};
