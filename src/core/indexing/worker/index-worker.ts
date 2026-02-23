import { extname } from "node:path";
import { resolveParser } from "../../parser/parser.registry";
import type { IndexWorker, IndexWorkerDeps } from "./index-worker.types";

export function createIndexWorker(deps: IndexWorkerDeps): IndexWorker {
  return {
    start() {
      deps.metadata.resetRunningJobsToPending();
    },

    async runOnce(nowMs = Date.now()) {
      const claimed = deps.metadata.claimDueJobs(deps.concurrency, nowMs);
      let settled = 0;
      let retried = 0;
      for (const job of claimed) {
        try {
          deps.onJobStart?.(job.path, job.jobType);
          if (job.jobType === "delete") {
            await deps.processor.deleteFile(job.path);
          } else {
            const parser = resolveParser({ ext: extname(job.path).toLowerCase() });
            if (parser.id !== "unsupported") {
              await deps.processor.indexFile(job.path, parser);
            }
          }
          deps.metadata.completeJob(job.jobId);
          deps.onJobDone?.(job.path, job.jobType);
          settled += 1;
        } catch (error) {
          deps.onJobError?.(job.path, job.jobType, String(error));
          if (job.attempt >= deps.maxAttempts) {
            deps.metadata.failJob(job.jobId, String(error));
            settled += 1;
            continue;
          }
          const backoff = deps.backoffMs[Math.min(job.attempt - 1, deps.backoffMs.length - 1)] ?? 1000;
          deps.metadata.retryJob(job.jobId, String(error), nowMs + backoff);
          retried += 1;
        }
      }
      return { claimed: claimed.length, settled, retried };
    },
  };
}
