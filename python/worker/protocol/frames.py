from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TypeGuard, cast

from .types import (
    PythonWorkerFrame,
    PythonWorkerStartRequestFrame,
)


def encode_frame(frame: PythonWorkerFrame) -> bytes:
    validate_frame(frame)
    return (json.dumps(frame, separators=(",", ":")) + "\n").encode("utf-8")


def decode_frame(line: bytes) -> PythonWorkerFrame:
    if not line:
        raise ValueError("frame is empty")

    try:
        decoded = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("frame is not valid json") from error

    validate_frame(decoded)
    return cast(PythonWorkerFrame, decoded)


def validate_frame(frame: object) -> None:
    if not isinstance(frame, Mapping):
        raise ValueError("frame must be a json object")

    if is_request_frame(frame):
        if frame.get("method") == "start" and not is_start_request_frame(frame):
            raise ValueError("frame does not match start request shape")
        return

    if is_response_frame(frame) or is_event_frame(frame):
        return

    raise ValueError("frame does not match request, response, or event shape")


def is_request_frame(frame: Mapping[str, object]) -> bool:
    return (
        isinstance(frame.get("id"), str)
        and bool(frame["id"])
        and isinstance(frame.get("method"), str)
        and bool(frame["method"])
        and "params" in frame
    )


def is_start_request_frame(frame: Mapping[str, object]) -> TypeGuard[PythonWorkerStartRequestFrame]:
    if not is_request_frame(frame):
        return False
    if frame.get("method") != "start":
        return False
    params = frame.get("params")
    return isinstance(params, Mapping) and _has_start_params(params)


def is_response_frame(frame: Mapping[str, object]) -> bool:
    frame_id = frame.get("id")
    if not isinstance(frame_id, str) or not frame_id:
        return False

    has_result = "result" in frame
    has_error = "error" in frame
    if has_result == has_error:
        return False

    if has_error:
        return is_error_frame(frame["error"])

    return True


def is_event_frame(frame: Mapping[str, object]) -> bool:
    return isinstance(frame.get("type"), str) and bool(frame["type"]) and "payload" in frame


def is_error_frame(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("code"), str)
        and bool(value["code"])
        and isinstance(value.get("message"), str)
        and bool(value["message"])
    )


def _has_start_params(params: Mapping[str, object]) -> bool:
    required_fields = ("basePath", "embeddingModel", "rerankerModel", "preferredDevice")
    if not all(isinstance(params.get(field), str) and params[field].strip() for field in required_fields):
        return False
    preferred_device = params["preferredDevice"]
    if preferred_device not in {"cpu", "mps", "cuda"}:
        return False
    core_config = params.get("coreConfig")
    if core_config is None:
        return True
    return _has_core_config(core_config)


def _has_core_config(value: object) -> bool:
    if not isinstance(value, Mapping):
        return False
    for field in ("embedding", "reranker", "ocr", "caption", "providers"):
        if field not in value:
            return False
    if not _has_embedding_section(value.get("embedding")):
        return False
    if not _has_reranker_section(value.get("reranker")):
        return False
    ocr = value.get("ocr")
    caption = value.get("caption")
    providers = value.get("providers")
    if not _has_local_ocr_model_section(ocr) or not _has_local_model_section(caption):
        return False
    return isinstance(providers, Mapping) and (
        "huggingface" not in providers
        or (
            isinstance(providers["huggingface"], Mapping)
            and isinstance(providers["huggingface"].get("endpoint"), str)
            and bool(providers["huggingface"]["endpoint"])
        )
    )


def _has_embedding_section(value: object) -> bool:
    if not isinstance(value, Mapping) or value.get("provider") not in {"local", "openai", "qwen"}:
        return False
    if value.get("provider") != "local":
        return True
    local = value.get("local")
    return (
        isinstance(local, Mapping)
        and isinstance(local.get("model"), str)
        and bool(local["model"])
        and isinstance(local.get("dimension"), int)
        and local["dimension"] > 0
    )


def _has_reranker_section(value: object) -> bool:
    if not isinstance(value, Mapping) or value.get("provider") not in {"local", "openai", "qwen"}:
        return False
    if not isinstance(value.get("enabled"), bool):
        return False
    if value.get("provider") != "local":
        return True
    local = value.get("local")
    return (
        isinstance(local, Mapping)
        and isinstance(local.get("model"), str)
        and bool(local["model"])
        and isinstance(local.get("topN"), int)
        and local["topN"] > 0
    )


def _has_local_model_section(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and value.get("provider") == "local"
        and isinstance(value.get("local"), Mapping)
        and isinstance(value["local"].get("model"), str)
        and bool(value["local"]["model"])
    )


def _has_local_ocr_model_section(value: object) -> bool:
    return (
        isinstance(value, Mapping)
        and value.get("provider") == "local"
        and isinstance(value.get("local"), Mapping)
        and isinstance(value["local"].get("model"), str)
        and bool(value["local"]["model"])
    )
