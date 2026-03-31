from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Literal, TypeAlias

ModelArtifactKind: TypeAlias = Literal["embedding", "reranker", "ocr", "caption"]


@dataclass(frozen=True, slots=True)
class ModelArtifactSpec:
    repo_required_files: frozenset[str]
    local_required_files: frozenset[str]
    runtime_managed: bool = False


_DEFAULT_SPECS: dict[ModelArtifactKind, ModelArtifactSpec] = {
    "embedding": ModelArtifactSpec(
        repo_required_files=frozenset(
            {
                "config.json",
                "config_sentence_transformers.json",
                "modules.json",
                "tokenizer.json",
                "tokenizer_config.json",
                "special_tokens_map.json",
                "sentence_bert_config.json",
                "1_Pooling/config.json",
                "model.safetensors",
                "pytorch_model.bin",
            }
        ),
        local_required_files=frozenset({"config.json", "modules.json", "1_Pooling/config.json"}),
    ),
    "reranker": ModelArtifactSpec(
        repo_required_files=frozenset(
            {
                "config.json",
                "tokenizer.json",
                "tokenizer_config.json",
                "special_tokens_map.json",
                "model.safetensors",
                "pytorch_model.bin",
            }
        ),
        local_required_files=frozenset({"config.json"}),
    ),
    "ocr": ModelArtifactSpec(
        repo_required_files=frozenset(
            {
                "config.json",
                "preprocessor_config.json",
                "processor_config.json",
                "tokenizer.model",
                "tokenizer.json",
                "tokenizer_config.json",
                "special_tokens_map.json",
                "model.safetensors",
                "pytorch_model.bin",
            }
        ),
        local_required_files=frozenset(
            {
                "config.json",
                "preprocessor_config.json",
                "processor_config.json",
                "tokenizer.model",
                "tokenizer.json",
                "tokenizer_config.json",
                "special_tokens_map.json",
            }
        ),
    ),
    "caption": ModelArtifactSpec(
        repo_required_files=frozenset(
            {
                "config.json",
                "processor_config.json",
                "tokenizer.json",
                "tokenizer_config.json",
                "special_tokens_map.json",
                "model.safetensors",
                "pytorch_model.bin",
            }
        ),
        local_required_files=frozenset(
            {
                "config.json",
                "processor_config.json",
                "tokenizer.json",
                "tokenizer_config.json",
                "special_tokens_map.json",
            }
        ),
    ),
}


def get_model_artifact_spec(kind: ModelArtifactKind, model: str) -> ModelArtifactSpec:
    payload = _load_model_artifact_payload().get(model)
    if payload is None:
        return _DEFAULT_SPECS[kind]
    resolved_kind = payload.get("kind")
    if resolved_kind != kind:
        raise ValueError(f"model {model} is registered as {resolved_kind}, not {kind}")
    return ModelArtifactSpec(
        repo_required_files=frozenset(str(item) for item in payload.get("repo_required_files", [])),
        local_required_files=frozenset(str(item) for item in payload.get("local_required_files", [])),
        runtime_managed=bool(payload.get("runtime_managed", False)),
    )


def resolve_ocr_preset(model: str) -> dict[str, str]:
    payload = _load_ocr_preset_payload().get(model)
    if payload is None:
        raise ValueError(f"invalid ocr model preset: {model}")
    return {str(key): str(value) for key, value in payload.items()}


def get_model_kind(model: str) -> ModelArtifactKind | None:
    payload = _load_model_artifact_payload().get(model)
    if payload is None:
        return None
    kind = payload.get("kind")
    if kind in {"embedding", "reranker", "ocr", "caption"}:
        return kind
    return None


@lru_cache(maxsize=1)
def _load_model_artifact_payload() -> dict[str, dict[str, object]]:
    path = Path(__file__).with_name("model_artifacts.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("model_artifacts.json must be a json object")
    return {str(key): value for key, value in payload.items() if isinstance(value, dict)}


@lru_cache(maxsize=1)
def _load_ocr_preset_payload() -> dict[str, dict[str, str]]:
    path = Path(__file__).with_name("ocr_presets.json")
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("ocr_presets.json must be a json object")
    return {str(key): value for key, value in payload.items() if isinstance(value, dict)}
