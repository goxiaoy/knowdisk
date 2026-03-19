from __future__ import annotations

from collections.abc import Iterable, Mapping

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


def select_embedding_repo_files(siblings: Iterable[Mapping[str, object] | ModelRepoFile]) -> list[ModelRepoFile]:
    return _select_required_files(siblings, required_files=_EMBEDDING_REQUIRED_FILES)


def select_reranker_repo_files(siblings: Iterable[Mapping[str, object] | ModelRepoFile]) -> list[ModelRepoFile]:
    return _select_required_files(siblings, required_files=_RERANKER_REQUIRED_FILES)


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
