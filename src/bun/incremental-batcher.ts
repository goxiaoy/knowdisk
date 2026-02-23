import type { FileChange } from "../core/indexing/indexing.service.types";

export type IncrementalBatcher = {
  enqueue: (path: string, type: FileChange["type"]) => void;
  flushNow: () => Promise<void>;
  dispose: () => void;
};

export function createIncrementalBatcher(opts: {
  debounceMs: number;
  runIncremental: (changes: FileChange[]) => Promise<unknown>;
  onError?: (error: unknown, changes: FileChange[]) => void;
}): IncrementalBatcher {
  const pending = new Map<string, FileChange["type"]>();
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    enqueue(path: string, type: FileChange["type"]) {
      pending.set(path, type);
      if (flushTimer) {
        clearTimeout(flushTimer);
      }
      flushTimer = setTimeout(() => {
        flushTimer = null;
        void runBuffered();
      }, Math.max(10, opts.debounceMs));
    },

    async flushNow() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      await runBuffered();
    },

    dispose() {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      pending.clear();
    },
  };

  async function runBuffered() {
    const changes = Array.from(pending.entries()).map(([path, type]) => ({ path, type }));
    pending.clear();
    if (changes.length === 0) {
      return;
    }
    try {
      await opts.runIncremental(changes);
    } catch (error) {
      opts.onError?.(error, changes);
    }
  }
}
