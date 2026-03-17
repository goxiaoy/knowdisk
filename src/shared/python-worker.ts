export type PythonWorkerRequest = {
  id: string;
  method: string;
  params: unknown;
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

function isPythonWorkerError(value: unknown): value is PythonWorkerError {
  return (
    isRecord(value) &&
    typeof value.code === "string" &&
    value.code.length > 0 &&
    typeof value.message === "string" &&
    value.message.length > 0
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
