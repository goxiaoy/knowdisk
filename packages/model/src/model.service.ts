import { EventEmitter } from "node:events";
import { access, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type {
  CreateModelServiceInput,
  LocalEmbeddingExtractor,
  LocalRerankerRuntime,
  ModelDownloadStatus,
  ModelDownloadTask,
  ModelService,
} from "./model.service.types";

const MODEL_RETRY_BACKOFF_MS = [3000, 10000, 30000];
const MODEL_RETRY_MAX_ATTEMPTS = MODEL_RETRY_BACKOFF_MS.length;

type LocalTaskKind = "embedding" | "reranker";

type LocalTaskSpec = {
  id: "embedding-local" | "reranker-local";
  kind: LocalTaskKind;
  model: string;
  provider: "local";
  hfEndpoint: string;
};

type RepoInfoResponse = {
  siblings?: Array<{ rfilename?: string; size?: number }>;
};

const EMPTY_STATUS: ModelDownloadStatus = {
  phase: "idle",
  lastStartedAt: "",
  lastFinishedAt: "",
  progressPct: 0,
  error: "",
  tasks: {
    embedding: null,
    reranker: null,
  },
  retry: {
    attempt: 0,
    maxAttempts: MODEL_RETRY_MAX_ATTEMPTS,
    backoffMs: [...MODEL_RETRY_BACKOFF_MS],
    nextRetryAt: "",
    exhausted: false,
  },
};

export function selectPreferredRepoFiles(
  siblings: Array<{ rfilename?: string; size?: number }>,
): Array<{ path: string; size: number }> {
  const requiredPaths = new Set([
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "added_tokens.json",
    "vocab.txt",
    "vocab.json",
    "merges.txt",
    "tokenizer.model",
    "sentencepiece.bpe.model",
    "preprocessor_config.json",
  ]);

  return siblings
    .filter(
      (item): item is { rfilename: string; size?: number } =>
        typeof item.rfilename === "string" &&
        item.rfilename.length > 0 &&
        (requiredPaths.has(item.rfilename) ||
          item.rfilename === "onnx/model.onnx" ||
          item.rfilename.startsWith("onnx/model.onnx")),
    )
    .map((item) => ({
      path: item.rfilename,
      size:
        Number.isFinite(item.size) && (item.size ?? 0) > 0
          ? Number(item.size)
          : 0,
    }));
}

export function createModelService(input: CreateModelServiceInput): ModelService {
  const emitter = new EventEmitter();
  const fetchImpl = input.deps?.fetch ?? fetch;
  const setTimeoutImpl = input.deps?.setTimeout ?? setTimeout;
  const clearTimeoutImpl = input.deps?.clearTimeout ?? clearTimeout;
  const now = input.deps?.now ?? (() => new Date().toISOString());
  let status: ModelDownloadStatus = EMPTY_STATUS;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let lastScope: LocalTaskKind | "all" | null = null;
  const embeddingRuntimeGuards = new Map<string, Promise<LocalEmbeddingExtractor>>();
  const rerankerRuntimeGuards = new Map<string, Promise<LocalRerankerRuntime>>();
  const embeddingVerifyGuards = new Map<string, Promise<LocalEmbeddingExtractor>>();
  const rerankerVerifyGuards = new Map<string, Promise<LocalRerankerRuntime>>();

  function emit() {
    emitter.emit("change", status);
  }

  function updateStatus(updater: (current: ModelDownloadStatus) => ModelDownloadStatus) {
    status = updater(status);
    emit();
  }

  function getStatus() {
    return {
      getSnapshot: () => status,
      subscribe(listener: (next: ModelDownloadStatus) => void) {
        emitter.on("change", listener);
        return () => {
          emitter.off("change", listener);
        };
      },
    };
  }

  function getHfEndpoint() {
    const endpoint = input.config.providers.huggingface?.endpoint ?? "";
    if (endpoint.trim().length === 0) {
      throw new Error("config.providers.huggingface.endpoint is required for local models");
    }
    return endpoint.replace(/\/+$/, "");
  }

  function buildSpecs(scope: LocalTaskKind | "all"): LocalTaskSpec[] {
    const endpoint = getHfEndpoint();
    const specs: LocalTaskSpec[] = [];
    if (
      (scope === "all" || scope === "embedding") &&
      input.config.embedding.provider === "local" &&
      input.config.embedding.local
    ) {
      specs.push({
        id: "embedding-local",
        kind: "embedding",
        model: input.config.embedding.local.model,
        provider: "local",
        hfEndpoint: endpoint,
      });
    }
    if (
      (scope === "all" || scope === "reranker") &&
      input.config.reranker.enabled &&
      input.config.reranker.provider === "local" &&
      input.config.reranker.local
    ) {
      specs.push({
        id: "reranker-local",
        kind: "reranker",
        model: input.config.reranker.local.model,
        provider: "local",
        hfEndpoint: endpoint,
      });
    }
    return specs;
  }

  function makeTask(spec: LocalTaskSpec): ModelDownloadTask {
    return {
      id: spec.id,
      model: spec.model,
      provider: spec.provider,
      state: "verifying",
      progressPct: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      error: "",
    };
  }

  function buildTasks(scope: LocalTaskKind | "all"): ModelDownloadStatus["tasks"] {
    const specs = buildSpecs(scope);
    return {
      embedding: specs.find((item) => item.kind === "embedding")
        ? makeTask(specs.find((item) => item.kind === "embedding")!)
        : scope === "reranker"
          ? status.tasks.embedding
          : null,
      reranker: specs.find((item) => item.kind === "reranker")
        ? makeTask(specs.find((item) => item.kind === "reranker")!)
        : scope === "embedding"
          ? status.tasks.reranker
          : null,
    };
  }

  function modelRoot(spec: LocalTaskSpec) {
    return join(input.cacheDir, spec.kind, spec.model);
  }

  async function pathExists(path: string) {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  }

  function computeAggregateProgress(tasks: ModelDownloadStatus["tasks"]) {
    const entries = [tasks.embedding, tasks.reranker].filter(Boolean);
    if (entries.length === 0) {
      return 100;
    }
    return Math.round(
      entries.reduce((sum, task) => sum + (task?.progressPct ?? 0), 0) / entries.length,
    );
  }

  function updateTask(id: ModelDownloadTask["id"], updater: (task: ModelDownloadTask) => ModelDownloadTask) {
    updateStatus((current) => {
      const nextTasks = {
        embedding:
          current.tasks.embedding?.id === id ? updater(current.tasks.embedding) : current.tasks.embedding,
        reranker:
          current.tasks.reranker?.id === id ? updater(current.tasks.reranker) : current.tasks.reranker,
      };
      return {
        ...current,
        tasks: nextTasks,
        progressPct: computeAggregateProgress(nextTasks),
      };
    });
  }

  async function fetchRepoFiles(spec: LocalTaskSpec) {
    const response = await fetchImpl(`${spec.hfEndpoint}/api/models/${spec.model}`);
    if (!response.ok) {
      throw new Error(`Failed to list model files: ${response.status} ${response.statusText}`);
    }
    const payload = (await response.json()) as RepoInfoResponse;
    const files = selectPreferredRepoFiles(payload.siblings ?? []);
    if (!files.some((file) => file.path === "onnx/model.onnx")) {
      throw new Error(`onnx/model.onnx not found for ${spec.model}`);
    }
    return files;
  }

  async function downloadFile(spec: LocalTaskSpec, file: { path: string; size: number }, totalBytes: number, downloadedState: { value: number }) {
    const destination = join(modelRoot(spec), file.path);
    await mkdir(dirname(destination), { recursive: true });
    const response = await fetchImpl(`${spec.hfEndpoint}/${spec.model}/resolve/main/${file.path}`);
    if (!response.ok) {
      throw new Error(`Failed to download ${file.path}: ${response.status} ${response.statusText}`);
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, buffer);
    downloadedState.value += buffer.length;
    updateTask(spec.id, (task) => ({
      ...task,
      state: "downloading",
      downloadedBytes: downloadedState.value,
      totalBytes,
      progressPct: totalBytes > 0 ? Math.min(100, Math.round((downloadedState.value / totalBytes) * 100)) : 100,
    }));
  }

  async function writeManifest(spec: LocalTaskSpec, files: string[]) {
    await writeFile(
      join(modelRoot(spec), ".knowdisk-manifest.json"),
      `${JSON.stringify(
        {
          model: spec.model,
          hfEndpoint: spec.hfEndpoint,
          downloadedAt: now(),
          files,
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  }

  async function ensureScope(scope: LocalTaskKind | "all") {
    lastScope = scope;
    if (retryTimer) {
      clearTimeoutImpl(retryTimer);
      retryTimer = null;
    }
    updateStatus((current) => ({
      ...current,
      phase: "verifying",
      lastStartedAt: now(),
      lastFinishedAt: "",
      error: "",
      progressPct: 0,
      tasks: buildTasks(scope),
      retry: {
        ...current.retry,
        nextRetryAt: "",
        exhausted: false,
      },
    }));

    const specs = buildSpecs(scope);
    if (specs.length === 0) {
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        lastFinishedAt: now(),
        progressPct: 100,
      }));
      return;
    }

    try {
      updateStatus((current) => ({ ...current, phase: "running" }));
      for (const spec of specs) {
        const files = await fetchRepoFiles(spec);
        const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
        const downloadedState = { value: 0 };
        updateTask(spec.id, (task) => ({
          ...task,
          state: "pending",
          totalBytes,
        }));
        for (const file of files) {
          await downloadFile(spec, file, totalBytes, downloadedState);
        }
        await writeManifest(spec, files.map((file) => file.path));
        await verifyModelIntegrity(spec);
        updateTask(spec.id, (task) => ({
          ...task,
          state: "ready",
          downloadedBytes: totalBytes,
          totalBytes,
          progressPct: 100,
        }));
      }
      updateStatus((current) => ({
        ...current,
        phase: "completed",
        lastFinishedAt: now(),
        progressPct: 100,
        retry: {
          ...current.retry,
          attempt: 0,
          nextRetryAt: "",
          exhausted: false,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      for (const spec of specs) {
        updateTask(spec.id, (task) => ({
          ...task,
          state: "failed",
          error: message,
        }));
      }
      const nextAttempt = status.retry.attempt + 1;
      const delay = MODEL_RETRY_BACKOFF_MS[Math.min(nextAttempt - 1, MODEL_RETRY_BACKOFF_MS.length - 1)] ?? 0;
      const exhausted = nextAttempt > MODEL_RETRY_MAX_ATTEMPTS;
      const nextRetryAt = exhausted ? "" : new Date(Date.now() + delay).toISOString();
      updateStatus((current) => ({
        ...current,
        phase: "failed",
        lastFinishedAt: now(),
        error: message,
        retry: {
          ...current.retry,
          attempt: nextAttempt,
          nextRetryAt,
          exhausted,
        },
      }));
      if (!exhausted) {
        retryTimer = setTimeoutImpl(() => {
          retryTimer = null;
          void ensureScope(lastScope ?? "all").catch(() => {});
        }, delay);
      }
      throw error;
    }
  }

  function pickSpec(kind: LocalTaskKind) {
    const spec = buildSpecs(kind)[0];
    if (!spec) {
      throw new Error(`Local ${kind} model is not enabled`);
    }
    return spec;
  }

  async function ensureModelFiles(spec: LocalTaskSpec) {
    const manifestPath = join(modelRoot(spec), ".knowdisk-manifest.json");
    if (!(await pathExists(manifestPath))) {
      await ensureScope(spec.kind);
      return;
    }
    const manifest = JSON.parse(await readFile(manifestPath, "utf8")) as { files?: string[] };
    for (const file of manifest.files ?? []) {
      if (!(await pathExists(join(modelRoot(spec), file)))) {
        await ensureScope(spec.kind);
        return;
      }
    }
  }

  async function configureTransformersEnv(spec: LocalTaskSpec) {
    const transformers = await import("@huggingface/transformers");
    const env = (transformers as { env?: { allowRemoteModels?: boolean; remoteHost?: string; localModelPath?: string; cacheDir?: string } }).env;
    if (env) {
      env.allowRemoteModels = false;
      env.remoteHost = `${spec.hfEndpoint}/`;
      env.localModelPath = join(input.cacheDir, spec.kind);
      env.cacheDir = join(input.cacheDir, spec.kind);
    }
  }

  async function defaultLoadEmbeddingExtractor(spec: LocalTaskSpec) {
    await configureTransformersEnv(spec);
    const transformers = await import("@huggingface/transformers");
    return (transformers as unknown as {
      pipeline: (
        task: "feature-extraction",
        model: string,
        opts: { local_files_only: true },
      ) => Promise<LocalEmbeddingExtractor>;
    }).pipeline("feature-extraction", spec.model, {
      local_files_only: true,
    });
  }

  async function defaultLoadRerankerRuntime(spec: LocalTaskSpec) {
    await configureTransformersEnv(spec);
    const transformers = await import("@huggingface/transformers");
    const tokenizer = await (transformers as unknown as {
      AutoTokenizer: {
        from_pretrained: (
          model: string,
          opts: { local_files_only: true },
        ) => Promise<(texts: string[], opts: { text_pair: string[]; padding: boolean; truncation: boolean }) => Promise<Record<string, unknown>>>;
      };
    }).AutoTokenizer.from_pretrained(spec.model, {
      local_files_only: true,
    });
    const model = await (transformers as unknown as {
      AutoModelForSequenceClassification: {
        from_pretrained: (
          model: string,
          opts: { quantized: false; local_files_only: true },
        ) => Promise<(inputs: unknown) => Promise<{ logits?: { data?: ArrayLike<number> } }>>;
      };
    }).AutoModelForSequenceClassification.from_pretrained(spec.model, {
      quantized: false,
      local_files_only: true,
    });
    return {
      async tokenizePairs(query: string, docs: string[]) {
        const queries = Array(docs.length).fill(query);
        return tokenizer(queries, {
          text_pair: docs,
          padding: true,
          truncation: true,
        });
      },
      async score(inputs: Record<string, unknown>) {
        const outputs = await model(inputs);
        return outputs.logits?.data ? Array.from(outputs.logits.data) : [];
      },
    } satisfies LocalRerankerRuntime;
  }

  async function verifyModelIntegrity(spec: LocalTaskSpec) {
    if (spec.kind === "embedding") {
      const key = `${spec.kind}:${spec.model}`;
      const existing = embeddingVerifyGuards.get(key);
      if (existing) {
        await existing;
        return;
      }
      const pending = input.deps?.loadEmbeddingExtractor
        ? input.deps.loadEmbeddingExtractor(
            spec.model,
            join(input.cacheDir, spec.kind),
            spec.hfEndpoint,
          )
        : defaultLoadEmbeddingExtractor(spec);
      embeddingVerifyGuards.set(key, pending);
      await pending;
      return;
    }

    const key = `${spec.kind}:${spec.model}`;
    const existing = rerankerVerifyGuards.get(key);
    if (existing) {
      await existing;
      return;
    }
    const pending = input.deps?.loadRerankerRuntime
      ? input.deps.loadRerankerRuntime(
          spec.model,
          join(input.cacheDir, spec.kind),
          spec.hfEndpoint,
        )
      : defaultLoadRerankerRuntime(spec);
    rerankerVerifyGuards.set(key, pending);
    await pending;
  }

  return {
    async ensureRequiredModels() {
      await ensureScope("all");
    },
    async getLocalEmbeddingExtractor() {
      if (input.config.embedding.provider !== "local") {
        throw new Error("Local embedding provider is not enabled");
      }
      const spec = pickSpec("embedding");
      const key = `${spec.kind}:${spec.model}`;
      const existing = embeddingRuntimeGuards.get(key);
      if (existing) {
        return existing;
      }
      const verified = embeddingVerifyGuards.get(key);
      if (verified) {
        embeddingRuntimeGuards.set(key, verified);
        return verified;
      }
      const pending = (async () => {
        await ensureModelFiles(spec);
        const postVerify = embeddingVerifyGuards.get(key);
        if (postVerify) {
          return postVerify;
        }
        return (input.deps?.loadEmbeddingExtractor ?? defaultLoadEmbeddingExtractor)(spec.model, join(input.cacheDir, spec.kind), spec.hfEndpoint);
      })();
      embeddingRuntimeGuards.set(key, pending);
      try {
        return await pending;
      } finally {
        if ((await Promise.resolve(pending).catch(() => null)) === null) {
          embeddingRuntimeGuards.delete(key);
        }
      }
    },
    async getLocalRerankerRuntime() {
      if (!input.config.reranker.enabled || input.config.reranker.provider !== "local") {
        throw new Error("Local reranker provider is not enabled");
      }
      const spec = pickSpec("reranker");
      const key = `${spec.kind}:${spec.model}`;
      const existing = rerankerRuntimeGuards.get(key);
      if (existing) {
        return existing;
      }
      const verified = rerankerVerifyGuards.get(key);
      if (verified) {
        rerankerRuntimeGuards.set(key, verified);
        return verified;
      }
      const pending = (async () => {
        await ensureModelFiles(spec);
        const postVerify = rerankerVerifyGuards.get(key);
        if (postVerify) {
          return postVerify;
        }
        return (input.deps?.loadRerankerRuntime ?? defaultLoadRerankerRuntime)(spec.model, join(input.cacheDir, spec.kind), spec.hfEndpoint);
      })();
      rerankerRuntimeGuards.set(key, pending);
      try {
        return await pending;
      } finally {
        if ((await Promise.resolve(pending).catch(() => null)) === null) {
          rerankerRuntimeGuards.delete(key);
        }
      }
    },
    async retryNow() {
      await ensureScope(lastScope ?? "all");
      return { ok: true };
    },
    async redownloadEmbeddingModel() {
      const spec = pickSpec("embedding");
      await rm(modelRoot(spec), { recursive: true, force: true });
      await ensureScope("embedding");
      return { ok: true };
    },
    async redownloadRerankerModel() {
      const spec = pickSpec("reranker");
      await rm(modelRoot(spec), { recursive: true, force: true });
      await ensureScope("reranker");
      return { ok: true };
    },
    getStatus,
  };
}
