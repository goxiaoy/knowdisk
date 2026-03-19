import json
from collections.abc import Mapping
from typing import Any


def encode_frame(frame: dict[str, Any]) -> bytes:
    validate_frame(frame)
    return (json.dumps(frame, separators=(",", ":")) + "\n").encode("utf-8")


def decode_frame(line: bytes) -> dict[str, Any]:
    if not line:
        raise ValueError("frame is empty")

    try:
        decoded = json.loads(line.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise ValueError("frame is not valid json") from error

    validate_frame(decoded)
    return decoded


def validate_frame(frame: Any) -> None:
    if not isinstance(frame, Mapping):
        raise ValueError("frame must be a json object")

    if is_request_frame(frame) or is_response_frame(frame) or is_event_frame(frame):
        return

    raise ValueError("frame does not match request, response, or event shape")


def is_request_frame(frame: Mapping[str, Any]) -> bool:
    return (
        isinstance(frame.get("id"), str)
        and bool(frame["id"])
        and isinstance(frame.get("method"), str)
        and bool(frame["method"])
        and "params" in frame
    )


def is_response_frame(frame: Mapping[str, Any]) -> bool:
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


def is_event_frame(frame: Mapping[str, Any]) -> bool:
    return isinstance(frame.get("type"), str) and bool(frame["type"]) and "payload" in frame


def is_start_request_frame(frame: Mapping[str, Any]) -> bool:
    return (
        is_request_frame(frame)
        and frame.get("method") == "start"
        and is_start_params(frame.get("params"))
    )


def is_start_params(value: Any) -> bool:
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("embeddingModel"), str)
        and bool(value["embeddingModel"])
        and isinstance(value.get("rerankerModel"), str)
        and bool(value["rerankerModel"])
        and value.get("preferredDevice") in {"cpu", "mps", "cuda"}
        and isinstance(value.get("modelCacheDir"), str)
        and bool(value["modelCacheDir"])
        and (
            "huggingfaceEndpoint" not in value
            or (
                isinstance(value.get("huggingfaceEndpoint"), str)
                and bool(value["huggingfaceEndpoint"])
            )
        )
    )


def is_error_frame(value: Any) -> bool:
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("code"), str)
        and bool(value["code"])
        and isinstance(value.get("message"), str)
        and bool(value["message"])
    )
