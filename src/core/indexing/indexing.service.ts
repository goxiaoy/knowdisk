export type FileChange = {
  path: string;
  type: string;
};

export type IndexingDeps = {
  pipeline: {
    rebuild: (reason: string) => Promise<unknown>;
    incremental: (changes: FileChange[]) => Promise<unknown>;
    reconcile: () => Promise<{ repaired: number }>;
    status: () => unknown;
  };
};

export function createIndexingService(deps: IndexingDeps) {
  return {
    async runFullRebuild(reason: string) {
      return deps.pipeline.rebuild(reason);
    },
    async runIncremental(changes: FileChange[]) {
      return deps.pipeline.incremental(changes);
    },
    async runScheduledReconcile() {
      return deps.pipeline.reconcile();
    },
    getIndexStatus() {
      return deps.pipeline.status();
    },
  };
}
