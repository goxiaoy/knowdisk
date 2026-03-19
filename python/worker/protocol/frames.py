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

    if is_request_frame(frame) or is_response_frame(frame) or is_event_frame(frame):
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
    required_fields = ("embeddingModel", "rerankerModel", "preferredDevice", "modelCacheDir")
    if not all(isinstance(params.get(field), str) and params[field].strip() for field in required_fields):
        return False
    preferred_device = params["preferredDevice"]
    return preferred_device in {"cpu", "mps", "cuda"}
