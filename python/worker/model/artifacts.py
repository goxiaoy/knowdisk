from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path

from worker.model.types import ModelRepoFile

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

_EMBEDDING_REQUIRED_LOCAL_FILES = {
    "config.json",
    "modules.json",
    "1_Pooling/config.json",
}

_RERANKER_REQUIRED_LOCAL_FILES = {
    "config.json",
}

_MODEL_WEIGHT_FILES = {
    "model.safetensors",
    "pytorch_model.bin",
}


def select_embedding_repo_files(siblings: Iterable[Mapping[str, object] | ModelRepoFile]) -> list[ModelRepoFile]:
    return _select_required_files(siblings, required_files=_EMBEDDING_REQUIRED_FILES)


def select_reranker_repo_files(siblings: Iterable[Mapping[str, object] | ModelRepoFile]) -> list[ModelRepoFile]:
    return _select_required_files(siblings, required_files=_RERANKER_REQUIRED_FILES)


def has_complete_local_model_artifacts(kind: str, model_root: str | Path) -> bool:
    root = Path(model_root)
    if not root.exists():
        return False
    if has_resumable_partial_downloads(root):
        return False

    if kind == "embedding":
        required_files = _EMBEDDING_REQUIRED_LOCAL_FILES
    else:
        required_files = _RERANKER_REQUIRED_LOCAL_FILES

    if not all((root / relative_path).is_file() for relative_path in required_files):
        return False

    return any((root / relative_path).is_file() for relative_path in _MODEL_WEIGHT_FILES)


def has_resumable_partial_downloads(model_root: str | Path) -> bool:
    root = Path(model_root)
    if not root.exists():
        return False
    return any(path.is_file() and path.name.endswith(".part") for path in root.rglob("*"))


def _select_required_files(
    siblings: Iterable[Mapping[str, object] | ModelRepoFile],
    required_files: set[str],
) -> list[ModelRepoFile]:
    selected: list[ModelRepoFile] = []
    for item in siblings:
        repo_file = item if isinstance(item, ModelRepoFile) else ModelRepoFile.from_mapping(item)
        if repo_file.path not in required_files:
            continue
        selected.append(repo_file)
    return selected
