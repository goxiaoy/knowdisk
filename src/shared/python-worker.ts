export type PythonWorkerRequest = {
  id: string;
  method: string;
  params: unknown;
};

export type PythonWorkerPreferredDevice = "cpu" | "mps" | "cuda";

export type PythonWorkerStartParams = {
  basePath: string;
  embeddingModel: string;
  rerankerModel: string;
  preferredDevice: PythonWorkerPreferredDevice;
  huggingfaceEndpoint?: string;
  coreConfig?: PythonWorkerCoreConfig;
};

export type PythonWorkerCoreConfig = {
  embedding: {
    provider: "local" | "openai" | "qwen";
    local?: {
      model: string;
      dimension: number;
    };
  };
  reranker: {
    enabled: boolean;
    provider: "local" | "openai" | "qwen";
    local?: {
      model: string;
      topN: number;
    };
  };
  ocr: {
    provider: "local";
    local?: {
      model: string;
    };
  };
  caption: {
    provider: "local";
    local?: {
      model: string;
    };
  };
  providers: {
    huggingface?: {
      endpoint: string;
    };
  };
};

export type PythonWorkerStartRequest = {
  id: string;
  method: "start";
  params: PythonWorkerStartParams;
};

export type PythonWorkerError = {
  code: string;
  message: string;
  data?: unknown;
};

export type PythonWorkerResponse =
  | {
      id: string;
      result: unknown;
      error?: never;
    }
  | {
      id: string;
      result?: never;
      error: PythonWorkerError;
    };

export type PythonWorkerEvent = {
  type: string;
  payload: unknown;
};

export function isPythonWorkerRequestFrame(value: unknown): value is PythonWorkerRequest {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.method === "string" &&
    value.method.length > 0 &&
    "params" in value
  );
}

export function isPythonWorkerResponseFrame(value: unknown): value is PythonWorkerResponse {
  if (!isRecord(value) || typeof value.id !== "string" || value.id.length === 0) {
    return false;
  }

  const hasResult = "result" in value;
  const hasError = "error" in value;

  if (hasResult === hasError) {
    return false;
  }

  if (hasError) {
    return isPythonWorkerError(value.error);
  }

  return true;
}

export function isPythonWorkerEventFrame(value: unknown): value is PythonWorkerEvent {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.type === "string" &&
    value.type.length > 0 &&
    "payload" in value
  );
}

export function isPythonWorkerStartRequestFrame(value: unknown): value is PythonWorkerStartRequest {
  if (!isPythonWorkerRequestFrame(value) || value.method !== "start") {
    return false;
  }

  return isPythonWorkerStartParams(value.params);
}

function isPythonWorkerError(value: unknown): value is PythonWorkerError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0
  );
}

function isPythonWorkerStartParams(value: unknown): value is PythonWorkerStartParams {
  if (!isRecord(value)) {
    return false;
  }

  const preferredDevice = value.preferredDevice;
  const hasPreferredDevice =
    preferredDevice === "cpu" || preferredDevice === "mps" || preferredDevice === "cuda";

  return (
    typeof value.basePath === "string" &&
    value.basePath.length > 0 &&
    typeof value.embeddingModel === "string" &&
    value.embeddingModel.length > 0 &&
    typeof value.rerankerModel === "string" &&
    value.rerankerModel.length > 0 &&
    hasPreferredDevice &&
    (value.coreConfig === undefined || isPythonWorkerCoreConfig(value.coreConfig)) &&
    (value.huggingfaceEndpoint === undefined ||
      (typeof value.huggingfaceEndpoint === "string" && value.huggingfaceEndpoint.length > 0))
  );
}

function isPythonWorkerCoreConfig(value: unknown): value is PythonWorkerCoreConfig {
  if (!isRecord(value)) {
    return false;
  }

  const embedding = value.embedding;
  const reranker = value.reranker;
  const ocr = value.ocr;
  const caption = value.caption;
  const providers = value.providers;
  if (!isRecord(embedding) || !isRecord(reranker) || !isRecord(ocr) || !isRecord(caption) || !isRecord(providers)) {
    return false;
  }

  const embeddingProvider = embedding.provider;
  const rerankerProvider = reranker.provider;
  if (
    (embeddingProvider !== "local" && embeddingProvider !== "openai" && embeddingProvider !== "qwen") ||
    (rerankerProvider !== "local" && rerankerProvider !== "openai" && rerankerProvider !== "qwen")
  ) {
    return false;
  }

  if (embeddingProvider === "local") {
    if (
      !isRecord(embedding.local) ||
      typeof embedding.local.model !== "string" ||
      embedding.local.model.length === 0 ||
      typeof embedding.local.dimension !== "number" ||
      !Number.isFinite(embedding.local.dimension) ||
      embedding.local.dimension <= 0
    ) {
      return false;
    }
  }

  if (typeof reranker.enabled !== "boolean") {
    return false;
  }

  if (rerankerProvider === "local") {
    if (
      !isRecord(reranker.local) ||
      typeof reranker.local.model !== "string" ||
      reranker.local.model.length === 0 ||
      typeof reranker.local.topN !== "number" ||
      !Number.isFinite(reranker.local.topN) ||
      reranker.local.topN <= 0
    ) {
      return false;
    }
  }

  if (ocr.provider !== "local" || !isRecord(ocr.local) || typeof ocr.local.model !== "string" || ocr.local.model.length === 0) {
    return false;
  }

  if (
    caption.provider !== "local" ||
    !isRecord(caption.local) ||
    typeof caption.local.model !== "string" ||
    caption.local.model.length === 0
  ) {
    return false;
  }

  const huggingface = providers.huggingface;
  return (
    huggingface === undefined ||
    (isRecord(huggingface) &&
      typeof huggingface.endpoint === "string" &&
      huggingface.endpoint.length > 0)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
