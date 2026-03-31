from __future__ import annotations

from collections.abc import Iterable, Mapping
from pathlib import Path

from worker.model.model_specs import get_model_artifact_spec, resolve_ocr_preset
from worker.model.types import DEFAULT_OCR_MODEL_DISPLAY, ModelArtifactKind, ModelRepoFile, ModelRuntimeConfig

_MODEL_WEIGHT_FILES = {
    "model.safetensors",
    "pytorch_model.bin",
    "inference.pdiparams",
    "inference.pdmodel",
}


def select_embedding_repo_files(
    siblings: Iterable[Mapping[str, object] | ModelRepoFile],
) -> list[ModelRepoFile]:
    return select_repo_files_for_model("embedding", "Alibaba-NLP/gte-multilingual-base", siblings)


def select_reranker_repo_files(
    siblings: Iterable[Mapping[str, object] | ModelRepoFile],
) -> list[ModelRepoFile]:
    return select_repo_files_for_model("reranker", "Alibaba-NLP/gte-multilingual-reranker-base", siblings)


def select_ocr_repo_files(
    siblings: Iterable[Mapping[str, object] | ModelRepoFile],
) -> list[ModelRepoFile]:
    return select_repo_files_for_model("ocr", DEFAULT_OCR_MODEL_DISPLAY, siblings)


def select_caption_repo_files(
    siblings: Iterable[Mapping[str, object] | ModelRepoFile],
) -> list[ModelRepoFile]:
    return select_repo_files_for_model("caption", "vikhyatk/moondream2", siblings)


def select_repo_files_for_model(
    kind: ModelArtifactKind,
    model: str,
    siblings: Iterable[Mapping[str, object] | ModelRepoFile],
) -> list[ModelRepoFile]:
    spec = get_model_artifact_spec(kind, model)
    return _select_required_files(siblings, required_files=set(spec.repo_required_files))


def has_complete_local_model_artifacts(
    kind: ModelArtifactKind | str,
    model_root: str | Path,
    *,
    model: str | None = None,
) -> bool:
    root = Path(model_root)
    if not root.exists():
        return False
    if has_resumable_partial_downloads(root):
        return False

    resolved_kind = kind if kind in {"embedding", "reranker", "ocr", "caption"} else None
    if resolved_kind is None:
        raise ValueError(f"unknown model artifact kind: {kind}")

    resolved_model = model or _default_model_for_kind(resolved_kind)
    spec = get_model_artifact_spec(resolved_kind, resolved_model)
    if spec.runtime_managed:
        return root.is_dir()

    if not all((root / relative_path).is_file() for relative_path in spec.local_required_files):
        return False

    return any((root / relative_path).is_file() for relative_path in _MODEL_WEIGHT_FILES)


def has_complete_local_ocr_artifacts(model_cache_dir: str | Path, runtime_config: ModelRuntimeConfig) -> bool:
    cache_dir = Path(model_cache_dir)
    component_models = tuple(dict.fromkeys(resolve_ocr_preset(runtime_config.ocr_model).values()))
    return all(
        has_complete_local_model_artifacts(
            "ocr",
            cache_dir / Path(*model.split("/")),
            model=model,
        )
        for model in component_models
    )


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
        if repo_file.path not in required_files and not _is_required_remote_code_file(repo_file.path):
            continue
        selected.append(repo_file)
    return selected


def _is_required_remote_code_file(path: str) -> bool:
    if "/" in path:
        return False
    return path.endswith(".py")


def _default_model_for_kind(kind: str) -> str:
    if kind == "embedding":
        return "Alibaba-NLP/gte-multilingual-base"
    if kind == "reranker":
        return "Alibaba-NLP/gte-multilingual-reranker-base"
    if kind == "ocr":
        return DEFAULT_OCR_MODEL_DISPLAY
    if kind == "caption":
        return "vikhyatk/moondream2"
    raise ValueError(f"unknown model artifact kind: {kind}")
