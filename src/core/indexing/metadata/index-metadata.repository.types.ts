export type IndexFileStatus = "indexed" | "indexing" | "failed" | "deleted" | "ignored";

export type IndexFileRow = {
  fileId: string;
  path: string;
  size: number;
  mtimeMs: number;
  inode: number | null;
  status: IndexFileStatus;
  lastIndexTimeMs: number | null;
  lastIndexModel: string | null;
  lastError: string | null;
  createdAtMs: number;
  updatedAtMs: number;
};

export type IndexChunkRow = {
  chunkId: string;
  fileId: string;
  sourcePath: string;
  startOffset: number | null;
  endOffset: number | null;
  chunkHash: string;
  tokenCount: number | null;
  updatedAtMs: number;
};

export type FtsChunkRow = {
  chunkId: string;
  fileId: string;
  sourcePath: string;
  title: string;
  text: string;
};

export type FtsSearchRow = {
  chunkId: string;
  fileId: string;
  sourcePath: string;
  text: string;
  score: number;
};

export type IndexJobType = "index" | "delete" | "reconcile";
export type IndexJobStatus = "pending" | "running" | "done" | "failed" | "canceled";

export type IndexJobRow = {
  jobId: string;
  path: string;
  jobType: IndexJobType;
  status: IndexJobStatus;
  reason: string;
  attempt: number;
  error: string | null;
  nextRunAtMs: number;
  createdAtMs: number;
  updatedAtMs: number;
};

export type NewIndexJob = {
  jobId: string;
  path: string;
  jobType: IndexJobType;
  reason: string;
  nextRunAtMs: number;
};

export type IndexMetadataRepository = {
  close: () => void;
  getSchemaVersion: () => number;

  upsertFile: (row: IndexFileRow) => void;
  getFileByPath: (path: string) => IndexFileRow | null;
  listFiles: () => IndexFileRow[];

  upsertChunks: (rows: IndexChunkRow[]) => void;
  listChunksByFileId: (fileId: string) => IndexChunkRow[];
  listChunksBySourcePath: (sourcePath: string) => IndexChunkRow[];
  deleteChunksByIds: (chunkIds: string[]) => void;

  upsertFtsChunks: (rows: FtsChunkRow[]) => void;
  searchFts: (query: string, limit: number) => FtsSearchRow[];
  searchTitleFts: (query: string, limit: number) => FtsSearchRow[];
  deleteFtsChunksByIds: (chunkIds: string[]) => void;

  enqueueJob: (job: NewIndexJob) => void;
  claimDueJobs: (limit: number, nowMs: number) => IndexJobRow[];
  getJobById: (jobId: string) => IndexJobRow | null;
  completeJob: (jobId: string) => void;
  failJob: (jobId: string, error: string) => void;
  retryJob: (jobId: string, error: string, nextRunAtMs: number) => void;
  resetRunningJobsToPending: () => number;

  listSourceTombstones: () => string[];
  addSourceTombstone: (path: string) => void;
  removeSourceTombstone: (path: string) => void;

  clearAllIndexData: () => void;
};
