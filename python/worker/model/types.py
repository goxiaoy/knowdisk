from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Mapping
from pathlib import Path
from typing import Literal, TypeAlias

ModelArtifactKind: TypeAlias = Literal["embedding", "reranker"]
ModelPreferredDevice: TypeAlias = Literal["cpu", "mps", "cuda"]


@dataclass(frozen=True, slots=True)
class ModelRuntimeConfig:
    base_path: Path
    embedding_model: str
    reranker_model: str
    preferred_device: ModelPreferredDevice
    model_cache_dir: Path
    huggingface_endpoint: str = ""

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ModelRuntimeConfig:
        preferred_device = str(value["preferredDevice"])
        if preferred_device not in {"cpu", "mps", "cuda"}:
            raise ValueError(f"invalid preferred device: {preferred_device}")
        huggingface_endpoint = value.get("huggingfaceEndpoint")
        return cls(
            base_path=Path(str(value["basePath"])),
            embedding_model=str(value["embeddingModel"]),
            reranker_model=str(value["rerankerModel"]),
            preferred_device=preferred_device,
            model_cache_dir=Path(str(value["basePath"])) / "model",
            huggingface_endpoint="" if huggingface_endpoint is None else str(huggingface_endpoint),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "basePath": str(self.base_path),
            "embeddingModel": self.embedding_model,
            "rerankerModel": self.reranker_model,
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
            size=_normalize_size(value.get("size")),
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


def _normalize_size(value: object) -> int:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value.is_integer() and value > 0:
        return int(value)
    return 0
