import sys
from pathlib import Path
from types import SimpleNamespace

from worker.model.runtime_loader import (
    _load_local_embedding_runtime,
    _load_local_reranker_runtime,
    load_local_embedding_runtime,
    load_local_reranker_runtime,
    select_runtime_device,
)


def test_select_runtime_device_prefers_cuda_when_available():
    assert (
        select_runtime_device(
            "cuda",
            is_cuda_available=lambda: True,
            is_mps_available=lambda: False,
        )
        == "cuda"
    )


def test_select_runtime_device_prefers_mps_when_available():
    assert (
        select_runtime_device(
            "mps",
            is_cuda_available=lambda: False,
            is_mps_available=lambda: True,
        )
        == "mps"
    )


def test_select_runtime_device_falls_back_to_cpu():
    assert (
        select_runtime_device(
            "cuda",
            is_cuda_available=lambda: False,
            is_mps_available=lambda: True,
        )
        == "cpu"
    )


def test_load_local_embedding_runtime_uses_resolved_device():
    calls: list[tuple[Path, str]] = []

    def loader(model_path: Path, device: str):
        calls.append((model_path, device))
        return {"model_path": model_path, "device": device}

    runtime = load_local_embedding_runtime(
        Path("/models/embed"),
        preferred_device="mps",
        is_cuda_available=lambda: False,
        is_mps_available=lambda: True,
        loader=loader,
    )

    assert runtime == {"model_path": Path("/models/embed"), "device": "mps"}
    assert calls == [(Path("/models/embed"), "mps")]


def test_load_local_reranker_runtime_uses_resolved_device():
    calls: list[tuple[Path, str]] = []

    def loader(model_path: Path, device: str):
        calls.append((model_path, device))
        return {"model_path": model_path, "device": device}

    runtime = load_local_reranker_runtime(
        Path("/models/reranker"),
        preferred_device="cuda",
        is_cuda_available=lambda: True,
        is_mps_available=lambda: False,
        loader=loader,
    )

    assert runtime == {"model_path": Path("/models/reranker"), "device": "cuda"}
    assert calls == [(Path("/models/reranker"), "cuda")]


def test_runtime_loader_errors_propagate():
    def loader(_model_path: Path, _device: str):
        raise RuntimeError("boom")

    try:
        load_local_embedding_runtime(
            Path("/models/embed"),
            preferred_device="cpu",
            is_cuda_available=lambda: False,
            is_mps_available=lambda: False,
            loader=loader,
        )
    except RuntimeError as error:
        assert str(error) == "boom"
    else:
        raise AssertionError("expected loader error to propagate")


def test_reranker_runtime_loader_errors_propagate():
    def loader(_model_path: Path, _device: str):
        raise RuntimeError("boom-reranker")

    try:
        load_local_reranker_runtime(
            Path("/models/reranker"),
            preferred_device="cpu",
            is_cuda_available=lambda: False,
            is_mps_available=lambda: False,
            loader=loader,
        )
    except RuntimeError as error:
        assert str(error) == "boom-reranker"
    else:
        raise AssertionError("expected reranker loader error to propagate")


def test_internal_embedding_runtime_loader_enables_trusted_remote_code(monkeypatch):
    calls: list[tuple[str, str, bool]] = []
    encode_calls: list[str] = []

    class FakeSentenceTransformer:
        def __init__(self, model_path: str, *, device: str, trust_remote_code: bool):
            calls.append((model_path, device, trust_remote_code))

        def encode(self, text: str):
            encode_calls.append(text)
            return (1.0, 2.0)

    monkeypatch.setitem(
        sys.modules,
        "sentence_transformers",
        SimpleNamespace(SentenceTransformer=FakeSentenceTransformer),
    )

    runtime = _load_local_embedding_runtime(Path("/models/embed"), "mps")

    assert calls == [("/models/embed", "mps", True)]
    assert list(runtime("hello")) == [1.0, 2.0]
    assert encode_calls == ["hello"]


def test_internal_reranker_runtime_loader_enables_trusted_remote_code(monkeypatch):
    tokenizer_calls: list[tuple[str, bool]] = []
    model_calls: list[tuple[str, bool]] = []

    class FakeTokenizer:
        pass

    class FakeModel:
        def to(self, device: str):
            return self

        def eval(self):
            return self

    class FakeAutoTokenizer:
        @staticmethod
        def from_pretrained(model_path: str, *, trust_remote_code: bool):
            tokenizer_calls.append((model_path, trust_remote_code))
            return FakeTokenizer()

    class FakeAutoModelForSequenceClassification:
        @staticmethod
        def from_pretrained(model_path: str, *, trust_remote_code: bool):
            model_calls.append((model_path, trust_remote_code))
            return FakeModel()

    monkeypatch.setitem(
        sys.modules,
        "transformers",
        SimpleNamespace(
            AutoTokenizer=FakeAutoTokenizer,
            AutoModelForSequenceClassification=FakeAutoModelForSequenceClassification,
        ),
    )

    tokenizer, model = _load_local_reranker_runtime(Path("/models/reranker"), "cpu")

    assert isinstance(tokenizer, FakeTokenizer)
    assert isinstance(model, FakeModel)
    assert tokenizer_calls == [("/models/reranker", True)]
    assert model_calls == [("/models/reranker", True)]
