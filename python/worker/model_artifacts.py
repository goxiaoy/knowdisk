from __future__ import annotations

from collections.abc import Iterable
from typing import Any

ModelRepoFile = dict[str, Any]

_EMBEDDING_REQUIRED_FILES = {
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

_RERANKER_REQUIRED_FILES = {
    "config.json",
    "tokenizer.json",
    "tokenizer_config.json",
    "special_tokens_map.json",
    "model.safetensors",
    "pytorch_model.bin",
}


def select_embedding_repo_files(siblings: Iterable[ModelRepoFile]) -> list[dict[str, Any]]:
    return _select_required_files(siblings, required_files=_EMBEDDING_REQUIRED_FILES)


def select_reranker_repo_files(siblings: Iterable[ModelRepoFile]) -> list[dict[str, Any]]:
    return _select_required_files(siblings, required_files=_RERANKER_REQUIRED_FILES)


def _select_required_files(
    siblings: Iterable[ModelRepoFile],
    required_files: set[str],
) -> list[dict[str, Any]]:
    selected: list[dict[str, Any]] = []
    for item in siblings:
        path = item.get("rfilename")
        if not isinstance(path, str) or not path:
            continue
        if path not in required_files:
            continue
        selected.append(
            {
                "path": path,
                "size": _normalize_size(item.get("size")),
            }
        )
    return selected


def _normalize_size(value: Any) -> int:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value.is_integer() and value > 0:
        return int(value)
    return 0
