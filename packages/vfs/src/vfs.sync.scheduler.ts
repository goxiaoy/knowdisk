import type { VfsSyncScheduler } from "./vfs.service.types";

type SyncJobType = "metadata_upsert" | "metadata_delete";

type SyncJob = {
  key: string;
  type: SyncJobType;
  mountId: string;
  sourceRef: string;
  dueAtMs: number;
  attempt: number;
};

export type VfsSyncSchedulerService = VfsSyncScheduler & {
  flushDue: () => Promise<number>;
  runReconcileDue: () => Promise<number>;
};

export function createVfsSyncScheduler(input: {
  debounceMs: number;
  retryBackoffMs: number[];
  reconcileMounts: Array<{ mountId: string; intervalMs: number }>;
  processMetadataUpsert: (job: { mountId: string; sourceRef: string }) => Promise<void>;
  processMetadataDelete: (job: { mountId: string; sourceRef: string }) => Promise<void>;
  runReconcile: (mountId: string) => Promise<void>;
  nowMs?: () => number;
}): VfsSyncSchedulerService {
  const nowMs = input.nowMs ?? (() => Date.now());
  const pending = new Map<string, SyncJob>();
  const reconcileState = new Map<string, { intervalMs: number; nextRunAtMs: number }>();

  for (const mount of input.reconcileMounts) {
    reconcileState.set(mount.mountId, {
      intervalMs: mount.intervalMs,
      nextRunAtMs: mount.intervalMs,
    });
  }

  return {
    async enqueueMetadataUpsert(job) {
      const key = `metadata_upsert:${job.mountId}:${job.sourceRef}`;
      pending.set(key, {
        key,
        type: "metadata_upsert",
        mountId: job.mountId,
        sourceRef: job.sourceRef,
        dueAtMs: nowMs() + input.debounceMs,
        attempt: 0,
      });
    },

    async enqueueMetadataDelete(job) {
      const key = `metadata_delete:${job.mountId}:${job.sourceRef}`;
      pending.set(key, {
        key,
        type: "metadata_delete",
        mountId: job.mountId,
        sourceRef: job.sourceRef,
        dueAtMs: nowMs() + input.debounceMs,
        attempt: 0,
      });
    },

    async flushDue() {
      const now = nowMs();
      const dueJobs = [...pending.values()].filter((job) => job.dueAtMs <= now);
      let processed = 0;

      for (const job of dueJobs) {
        try {
          if (job.type === "metadata_upsert") {
            await input.processMetadataUpsert({ mountId: job.mountId, sourceRef: job.sourceRef });
          } else {
            await input.processMetadataDelete({ mountId: job.mountId, sourceRef: job.sourceRef });
          }
          pending.delete(job.key);
          processed += 1;
        } catch {
          job.attempt += 1;
          const backoffIndex = Math.min(job.attempt - 1, input.retryBackoffMs.length - 1);
          const backoff = input.retryBackoffMs[backoffIndex] ?? 0;
          if (job.attempt > input.retryBackoffMs.length) {
            pending.delete(job.key);
          } else {
            pending.set(job.key, {
              ...job,
              dueAtMs: now + backoff,
            });
          }
        }
      }

      return processed;
    },

    async runReconcileDue() {
      const now = nowMs();
      let processed = 0;

      for (const [mountId, state] of reconcileState.entries()) {
        if (now < state.nextRunAtMs) {
          continue;
        }
        await input.runReconcile(mountId);
        reconcileState.set(mountId, {
          ...state,
          nextRunAtMs: now + state.intervalMs,
        });
        processed += 1;
      }

      return processed;
    },
  };
}
