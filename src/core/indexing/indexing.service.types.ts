export type FileChange = {
  path: string;
  type: string;
};

export type IndexingStatus = {
  running: boolean;
  lastReason: string;
  lastRunAt: string;
  currentFile: string | null;
  indexedFiles: number;
  errors: string[];
};

export type IndexingStatusStore = {
  getSnapshot: () => IndexingStatus;
  subscribe: (listener: (status: IndexingStatus) => void) => () => void;
};

export type IndexingService = {
  runFullRebuild: (reason: string) => Promise<unknown>;
  runIncremental: (changes: FileChange[]) => Promise<unknown>;
  runScheduledReconcile: () => Promise<{ repaired: number }>;
  getIndexStatus: () => IndexingStatusStore;
};
