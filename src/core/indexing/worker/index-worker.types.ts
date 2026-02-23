import type { Parser } from "../../parser/parser.types";
import type { IndexMetadataRepository } from "../metadata/index-metadata.repository.types";

export type WorkerProcessor = {
  indexFile: (path: string, parser: Parser) => Promise<{ skipped: boolean; indexedChunks: number }>;
  deleteFile: (path: string) => Promise<void>;
};

export type IndexWorker = {
  start: () => void;
  runOnce: (nowMs?: number) => Promise<number>;
};

export type IndexWorkerDeps = {
  metadata: Pick<
    IndexMetadataRepository,
    "claimDueJobs" | "completeJob" | "failJob" | "retryJob" | "resetRunningJobsToPending"
  >;
  processor: WorkerProcessor;
  concurrency: number;
  maxAttempts: number;
  backoffMs: number[];
  onJobStart?: (path: string) => void;
  onJobDone?: (path: string) => void;
  onJobError?: (path: string, error: string) => void;
};
