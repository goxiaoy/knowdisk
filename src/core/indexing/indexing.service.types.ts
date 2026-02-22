export type FileChange = {
  path: string;
  type: string;
};

export type IndexingService = {
  runFullRebuild: (reason: string) => Promise<unknown>;
  runIncremental: (changes: FileChange[]) => Promise<unknown>;
  runScheduledReconcile: () => Promise<{ repaired: number }>;
  getIndexStatus: () => unknown;
};

