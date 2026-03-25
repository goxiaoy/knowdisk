from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Mapping
from pathlib import Path
from typing import Literal, TypeAlias

ModelArtifactKind: TypeAlias = Literal["embedding", "reranker", "ocr", "caption"]
ModelPreferredDevice: TypeAlias = Literal["cpu", "mps", "cuda"]


@dataclass(frozen=True, slots=True)
class ModelRuntimeConfig:
    base_path: Path
    embedding_model: str
    reranker_model: str
    ocr_model: str
    caption_model: str
    preferred_device: ModelPreferredDevice
    model_cache_dir: Path
    huggingface_endpoint: str = ""

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ModelRuntimeConfig:
        preferred_device = str(value["preferredDevice"])
        if preferred_device not in {"cpu", "mps", "cuda"}:
            raise ValueError(f"invalid preferred device: {preferred_device}")

        ocr_model = _extract_model_id(value, "ocr", fallback="PaddlePaddle/PaddleOCR-VL")
        caption_model = _extract_model_id(value, "caption", fallback="vikhyatk/moondream2")
        huggingface_endpoint = value.get("huggingfaceEndpoint")
        return cls(
            base_path=Path(str(value["basePath"])),
            embedding_model=str(value["embeddingModel"]),
            reranker_model=str(value["rerankerModel"]),
            ocr_model=ocr_model,
            caption_model=caption_model,
            preferred_device=preferred_device,
            model_cache_dir=Path(str(value["basePath"])) / "model",
            huggingface_endpoint="" if huggingface_endpoint is None else str(huggingface_endpoint),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "basePath": str(self.base_path),
            "embeddingModel": self.embedding_model,
            "rerankerModel": self.reranker_model,
            "ocrModel": self.ocr_model,
            "captionModel": self.caption_model,
            "preferredDevice": self.preferred_device,
            "modelCacheDir": str(self.model_cache_dir),
        }
        if self.huggingface_endpoint:
            result["huggingfaceEndpoint"] = self.huggingface_endpoint
        return result


@dataclass(frozen=True, slots=True)
class ModelRepoFile:
    path: str
    size: int

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ModelRepoFile:
        return cls(
            path=str(value["rfilename"]),
            size=_normalize_repo_file_size(value),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        return {
            "rfilename": self.path,
            "size": self.size,
        }


@dataclass(frozen=True, slots=True)
class LoadedRerankerRuntime:
    tokenizer: object
    model: object


@dataclass(frozen=True, slots=True)
class LoadedOcrRuntime:
    model_root: Path
    preferred_device: ModelPreferredDevice
    model: object | None = None
    processor: object | None = None
    device: str = "cpu"


@dataclass(frozen=True, slots=True)
class LoadedCaptionRuntime:
    model_root: Path
    preferred_device: ModelPreferredDevice
    model: object | None = None
    device: str = "cpu"


def _normalize_size(value: object) -> int:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value.is_integer() and value > 0:
        return int(value)
    return 0


def _normalize_repo_file_size(value: Mapping[str, object]) -> int:
    direct_size = _normalize_size(value.get("size"))
    if direct_size > 0:
        return direct_size

    lfs_value = value.get("lfs")
    if isinstance(lfs_value, Mapping):
        return _normalize_size(lfs_value.get("size"))

    return 0


def _extract_model_id(value: Mapping[str, object], kind: str, *, fallback: str) -> str:
    top_level_key = f"{kind}Model"
    top_level_value = value.get(top_level_key)
    if isinstance(top_level_value, str) and top_level_value.strip():
        return top_level_value

    core_config_value = value.get("coreConfig")
    if core_config_value is None:
        return fallback
    if not isinstance(core_config_value, Mapping):
        raise ValueError(f"missing required {kind} model configuration")

    section_value = core_config_value.get(kind)
    if not isinstance(section_value, Mapping):
        raise ValueError(f"missing required {kind} model configuration")

    local_value = section_value.get("local")
    if not isinstance(local_value, Mapping):
        raise ValueError(f"missing required {kind} model configuration")

    model_value = local_value.get("model")
    if not isinstance(model_value, str) or not model_value.strip():
        return fallback

    return model_value
