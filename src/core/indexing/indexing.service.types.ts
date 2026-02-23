export type FileChange = {
  path: string;
  type: string;
};

export type IndexRunPhase = "idle" | "running";
export type IndexSchedulerPhase = "idle" | "enqueueing" | "draining";
export type IndexWorkerPhase =
  | "idle"
  | "indexing"
  | "deleting"
  | "retrying"
  | "failed";

export type IndexingStatus = {
  run: {
    phase: IndexRunPhase;
    reason: string;
    startedAt: string;
    finishedAt: string;
    lastReconcileAt: string;
    indexedFiles: number;
    errors: string[];
  };
  scheduler: {
    phase: IndexSchedulerPhase;
    queueDepth: number;
  };
  worker: {
    phase: IndexWorkerPhase;
    runningWorkers: number;
    currentFiles: string[];
    lastError: string;
  };
};

export type IndexingStatusStore = {
  getSnapshot: () => IndexingStatus;
  subscribe: (listener: (status: IndexingStatus) => void) => () => void;
};

export type IndexingService = {
  runFullRebuild: (reason: string) => Promise<unknown>;
  runIncremental: (changes: FileChange[]) => Promise<unknown>;
  runScheduledReconcile: () => Promise<{ repaired: number }>;
  deferSourceDeletion: (sourcePath: string) => void;
  cancelDeferredSourceDeletion: (sourcePath: string) => void;
  purgeDeferredSourceDeletions: () => Promise<{
    removedSources: number;
    deletedFiles: number;
  }>;
  clearAllIndexData: () => void;
  getIndexStatus: () => IndexingStatusStore;
};
