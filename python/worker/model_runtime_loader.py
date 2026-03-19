from __future__ import annotations

from collections.abc import Callable
from pathlib import Path
from typing import Any, Literal

RuntimeDevice = Literal["cpu", "mps", "cuda"]
DeviceAvailability = Callable[[], bool]
EmbeddingRuntimeLoader = Callable[[Path, RuntimeDevice], Any]
RerankerRuntimeLoader = Callable[[Path, RuntimeDevice], Any]


def select_runtime_device(
    preferred_device: str,
    *,
    is_cuda_available: DeviceAvailability,
    is_mps_available: DeviceAvailability,
) -> RuntimeDevice:
    if preferred_device == "cuda" and is_cuda_available():
        return "cuda"
    if preferred_device == "mps" and is_mps_available():
        return "mps"
    return "cpu"


def load_local_embedding_runtime(
    model_path: str | Path,
    *,
    preferred_device: str,
    is_cuda_available: DeviceAvailability | None = None,
    is_mps_available: DeviceAvailability | None = None,
    loader: EmbeddingRuntimeLoader | None = None,
) -> Any:
    resolved_device = select_runtime_device(
        preferred_device,
        is_cuda_available=is_cuda_available or _cuda_is_available,
        is_mps_available=is_mps_available or _mps_is_available,
    )
    runtime_loader = loader or _load_local_embedding_runtime
    return runtime_loader(Path(model_path), resolved_device)


def load_local_reranker_runtime(
    model_path: str | Path,
    *,
    preferred_device: str,
    is_cuda_available: DeviceAvailability | None = None,
    is_mps_available: DeviceAvailability | None = None,
    loader: RerankerRuntimeLoader | None = None,
) -> Any:
    resolved_device = select_runtime_device(
        preferred_device,
        is_cuda_available=is_cuda_available or _cuda_is_available,
        is_mps_available=is_mps_available or _mps_is_available,
    )
    runtime_loader = loader or _load_local_reranker_runtime
    return runtime_loader(Path(model_path), resolved_device)


def _load_local_embedding_runtime(model_path: Path, device: RuntimeDevice) -> Any:
    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(str(model_path), device=device)


def _load_local_reranker_runtime(model_path: Path, device: RuntimeDevice) -> Any:
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(str(model_path))
    model = AutoModelForSequenceClassification.from_pretrained(str(model_path))
    if hasattr(model, "to"):
        model = model.to(device)
    if hasattr(model, "eval"):
        model = model.eval()
    return tokenizer, model


def _cuda_is_available() -> bool:
    try:
        import torch
    except ImportError:
        return False
    return bool(torch.cuda.is_available())


def _mps_is_available() -> bool:
    try:
        import torch
    except ImportError:
        return False

    mps = getattr(torch.backends, "mps", None)
    return bool(mps is not None and mps.is_available())
