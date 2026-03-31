from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from urllib.error import HTTPError

from worker.model.artifact_manager import ModelArtifactManager
from worker.model.types import ModelRepoFile, ModelRuntimeConfig


@dataclass
class FakeResponse:
    status: int
    headers: dict[str, str]
    body: list[bytes] | bytes | None = None
    payload: dict | None = None

    def json(self) -> dict:
        assert self.payload is not None
        return self.payload


@dataclass
class FakeBodyOnlyResponse:
    status: int
    headers: dict[str, str]
    body: list[bytes] | bytes | None = None


def test_lists_model_files_from_configured_endpoint(tmp_path: Path):
    calls: list[str] = []

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        _ = headers
        calls.append(url)
        return FakeResponse(
            status=200,
            headers={"content-type": "application/json"},
            payload={
                "siblings": [
                    {"rfilename": "config.json", "size": 1},
                    {"rfilename": "tokenizer.json", "size": 2},
                ]
            },
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    files = manager.list_model_files("embedding", "Alibaba-NLP/gte-multilingual-base")

    assert [item.path for item in files] == ["config.json", "tokenizer.json"]
    assert calls == ["https://hf.example/api/models/Alibaba-NLP/gte-multilingual-base"]


def test_lists_model_files_from_body_only_response(tmp_path: Path):
    calls: list[str] = []

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeBodyOnlyResponse:
        _ = headers
        calls.append(url)
        return FakeBodyOnlyResponse(
            status=200,
            headers={"content-type": "application/json"},
            body=[
                b'{"siblings":[',
                b'{"rfilename":"config.json","size":1},',
                b'{"rfilename":"tokenizer.json","size":2}',
                b"]}",
            ],
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    files = manager.list_model_files("embedding", "Alibaba-NLP/gte-multilingual-base")

    assert [item.path for item in files] == ["config.json", "tokenizer.json"]
    assert calls == ["https://hf.example/api/models/Alibaba-NLP/gte-multilingual-base"]


def test_rejects_repo_listings_without_required_files(tmp_path: Path):
    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        _ = (url, headers)
        return FakeResponse(
            status=200,
            headers={"content-type": "application/json"},
            payload={"siblings": [{"rfilename": "README.md", "size": 1}]},
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    try:
        manager.list_model_files("embedding", "Alibaba-NLP/gte-multilingual-base")
    except ValueError as error:
        assert "No required model artifacts found" in str(error)
    else:
        raise AssertionError("expected list_model_files to reject empty selections")


def test_downloads_all_required_files_into_correct_cache_directory(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    progress: list[tuple[int, int]] = []

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        if url.endswith("/api/models/Alibaba-NLP/gte-multilingual-base"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={
                    "siblings": [
                        {"rfilename": "config.json", "size": 4},
                        {"rfilename": "modules.json", "size": 4},
                        {"rfilename": "tokenizer.json", "size": 4},
                        {"rfilename": "tokenizer_config.json", "size": 4},
                        {"rfilename": "special_tokens_map.json", "size": 4},
                        {"rfilename": "sentence_bert_config.json", "size": 4},
                        {"rfilename": "1_Pooling/config.json", "size": 4},
                        {"rfilename": "model.safetensors", "size": 4},
                    ]
                },
            )
        return FakeResponse(
            status=200,
            headers={"content-length": "4"},
            body=[b"test"],
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    result = manager.ensure_artifacts(
        kind="embedding",
        model="Alibaba-NLP/gte-multilingual-base",
        on_progress=lambda downloaded, total: progress.append((downloaded, total)),
    )

    assert result.model_root == tmp_path / "cache" / "Alibaba-NLP" / "gte-multilingual-base"
    assert result.files == [
        ModelRepoFile(path="config.json", size=4),
        ModelRepoFile(path="modules.json", size=4),
        ModelRepoFile(path="tokenizer.json", size=4),
        ModelRepoFile(path="tokenizer_config.json", size=4),
        ModelRepoFile(path="special_tokens_map.json", size=4),
        ModelRepoFile(path="sentence_bert_config.json", size=4),
        ModelRepoFile(path="1_Pooling/config.json", size=4),
        ModelRepoFile(path="model.safetensors", size=4),
    ]
    assert result.downloaded_files == 8
    assert (result.model_root / "config.json").read_bytes() == b"test"
    assert (result.model_root / "model.safetensors").read_bytes() == b"test"
    assert progress[-1] == (32, 32)


def test_preserves_partial_downloads_for_resume(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    model_root = tmp_path / "cache" / "Alibaba-NLP" / "gte-multilingual-base"
    part_path = model_root / "config.json.part"
    part_path.parent.mkdir(parents=True, exist_ok=True)
    part_path.write_bytes(b"te")

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        if url.endswith("/api/models/Alibaba-NLP/gte-multilingual-base"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={"siblings": [{"rfilename": "config.json", "size": 4}]},
            )
        assert headers == {"Range": "bytes=2-"}
        return FakeResponse(
            status=206,
            headers={
                "content-length": "2",
                "content-range": "bytes 2-3/4",
            },
            body=[b"st"],
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    result = manager.ensure_artifacts(
        kind="embedding",
        model="Alibaba-NLP/gte-multilingual-base",
    )

    assert result.model_root == model_root
    assert (model_root / "config.json").read_bytes() == b"test"
    assert not part_path.exists()
    assert calls[1][1] == {"Range": "bytes=2-"}


def test_skips_completed_files_and_reports_existing_bytes_in_progress(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    progress: list[tuple[int, int]] = []
    model_root = tmp_path / "cache" / "Alibaba-NLP" / "gte-multilingual-base"
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / "config.json").write_bytes(b"done")
    (model_root / "modules.json.part").write_bytes(b"te")

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        if url.endswith("/api/models/Alibaba-NLP/gte-multilingual-base"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={
                    "siblings": [
                        {"rfilename": "config.json", "size": 4},
                        {"rfilename": "modules.json", "size": 4},
                        {"rfilename": "tokenizer.json", "size": 4},
                    ]
                },
            )
        if url.endswith("/modules.json"):
            assert headers == {"Range": "bytes=2-"}
            return FakeResponse(
                status=206,
                headers={
                    "content-length": "2",
                    "content-range": "bytes 2-3/4",
                },
                body=[b"st"],
            )
        assert url.endswith("/tokenizer.json")
        assert headers is None
        return FakeResponse(
            status=200,
            headers={"content-length": "4"},
            body=[b"new!"],
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    result = manager.ensure_artifacts(
        kind="embedding",
        model="Alibaba-NLP/gte-multilingual-base",
        on_progress=lambda downloaded, total: progress.append((downloaded, total)),
    )

    assert result.model_root == model_root
    assert result.downloaded_files == 2
    assert (model_root / "config.json").read_bytes() == b"done"
    assert (model_root / "modules.json").read_bytes() == b"test"
    assert (model_root / "tokenizer.json").read_bytes() == b"new!"
    assert calls == [
        ("https://hf.example/api/models/Alibaba-NLP/gte-multilingual-base", None),
        ("https://hf.example/Alibaba-NLP/gte-multilingual-base/resolve/main/modules.json", {"Range": "bytes=2-"}),
        ("https://hf.example/Alibaba-NLP/gte-multilingual-base/resolve/main/tokenizer.json", None),
    ]
    assert progress[0] == (4, 12)
    assert progress[-1] == (12, 12)


def test_reuses_complete_local_artifacts_without_listing_remote_files(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    model_root = tmp_path / "cache" / "Alibaba-NLP" / "gte-multilingual-base"
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / "config.json").write_text("{}", encoding="utf-8")
    (model_root / "modules.json").write_text("[]", encoding="utf-8")
    (model_root / "1_Pooling").mkdir(parents=True, exist_ok=True)
    (model_root / "1_Pooling" / "config.json").write_text("{}", encoding="utf-8")
    (model_root / "model.safetensors").write_bytes(b"weights")

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        raise AssertionError("remote fetch should not be called for complete local artifacts")

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    result = manager.ensure_artifacts(
        kind="embedding",
        model="Alibaba-NLP/gte-multilingual-base",
    )

    assert result.model_root == model_root
    assert result.downloaded_files == 0
    assert result.downloaded_bytes == 0
    assert calls == []


def test_force_redownload_replaces_damaged_local_state(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    model_root = tmp_path / "cache" / "Alibaba-NLP" / "gte-multilingual-reranker-base"
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / "damaged.txt").write_text("old", encoding="utf-8")
    (model_root / "config.json.part").write_text("stale", encoding="utf-8")

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        if url.endswith("/api/models/Alibaba-NLP/gte-multilingual-reranker-base"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={
                    "siblings": [
                        {"rfilename": "config.json", "size": 4},
                        {"rfilename": "tokenizer.json", "size": 4},
                        {"rfilename": "tokenizer_config.json", "size": 4},
                        {"rfilename": "special_tokens_map.json", "size": 4},
                        {"rfilename": "pytorch_model.bin", "size": 4},
                    ]
                },
            )
        return FakeResponse(
            status=200,
            headers={"content-length": "4"},
            body=[b"data"],
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    result = manager.ensure_artifacts(
        kind="reranker",
        model="Alibaba-NLP/gte-multilingual-reranker-base",
        force_redownload=True,
    )

    assert result.model_root == model_root
    assert not (model_root / "damaged.txt").exists()
    assert not (model_root / "config.json.part").exists()
    assert (model_root / "config.json").read_bytes() == b"data"
    assert all(headers is None for _url, headers in calls if "/resolve/main/" in _url)


def test_resolves_missing_repo_file_sizes_from_range_probe(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    progress: list[tuple[int, int]] = []

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        if url.endswith("/api/models/Alibaba-NLP/gte-multilingual-base"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={
                    "siblings": [
                        {"rfilename": "config.json"},
                        {"rfilename": "model.safetensors", "lfs": {"size": 6}},
                    ]
                },
            )
        if url.endswith("/config.json") and headers == {"Range": "bytes=0-0"}:
            return FakeResponse(
                status=206,
                headers={
                    "content-length": "1",
                    "content-range": "bytes 0-0/4",
                },
                body=[b"{"],
            )
        if url.endswith("/config.json"):
            return FakeResponse(
                status=200,
                headers={"content-length": "4"},
                body=[b"test"],
            )
        return FakeResponse(
            status=200,
            headers={"content-length": "6"},
            body=[b"weight"],
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    result = manager.ensure_artifacts(
        kind="embedding",
        model="Alibaba-NLP/gte-multilingual-base",
        on_progress=lambda downloaded, total: progress.append((downloaded, total)),
    )

    assert result.files == [
        ModelRepoFile(path="config.json", size=4),
        ModelRepoFile(path="model.safetensors", size=6),
    ]
    assert progress[-1] == (10, 10)
    assert calls[:2] == [
        ("https://hf.example/api/models/Alibaba-NLP/gte-multilingual-base", None),
        ("https://hf.example/Alibaba-NLP/gte-multilingual-base/resolve/main/config.json", {"Range": "bytes=0-0"}),
    ]


def test_download_errors_include_endpoint_details(tmp_path: Path):
    def fetch(url: str, headers: dict[str, str] | None = None):
        _ = headers
        if url.endswith("/api/models/Alibaba-NLP/gte-multilingual-reranker-base"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={
                    "siblings": [
                        {"rfilename": "config.json", "size": 4},
                        {"rfilename": "tokenizer.json", "size": 4},
                        {"rfilename": "tokenizer_config.json", "size": 4},
                        {"rfilename": "special_tokens_map.json", "size": 4},
                        {"rfilename": "model.safetensors", "size": 4},
                    ]
                },
            )
        raise HTTPError(
            url=url,
            code=403,
            msg="Forbidden",
            hdrs=None,
            fp=None,
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    try:
        manager.ensure_artifacts(kind="reranker", model="Alibaba-NLP/gte-multilingual-reranker-base")
    except ValueError as error:
        message = str(error)
        assert "failed to download" in message
        assert "https://hf.example/Alibaba-NLP/gte-multilingual-reranker-base/resolve/main/config.json" in message
        assert "endpoint=https://hf.example" in message
        assert "host=hf.example" in message
        assert "HTTP Error 403: Forbidden" in message
    else:
        raise AssertionError("expected ensure_artifacts to report endpoint details on download error")


def test_list_model_file_errors_include_endpoint_details(tmp_path: Path):
    def fetch(url: str, headers: dict[str, str] | None = None):
        _ = headers
        raise HTTPError(
            url=url,
            code=403,
            msg="Forbidden",
            hdrs=None,
            fp=None,
        )

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )

    try:
        manager.list_model_files("reranker", "Alibaba-NLP/gte-multilingual-reranker-base")
    except ValueError as error:
        message = str(error)
        assert "failed to fetch https://hf.example/api/models/Alibaba-NLP/gte-multilingual-reranker-base" in message
        assert "endpoint=https://hf.example" in message
        assert "host=hf.example" in message
        assert "HTTP Error 403: Forbidden" in message
    else:
        raise AssertionError("expected list_model_files to report endpoint details on fetch error")


def test_ensure_ocr_artifacts_downloads_detection_recognition_and_layout_models(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    progress: list[tuple[int, int]] = []

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        if url.endswith("/api/models/PaddlePaddle/PP-OCRv4_mobile_det"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={"siblings": [{"rfilename": "config.json", "size": 4}, {"rfilename": "model.safetensors", "size": 4}]},
            )
        if url.endswith("/api/models/PaddlePaddle/PP-OCRv4_mobile_rec"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={"siblings": [{"rfilename": "config.json", "size": 4}, {"rfilename": "model.safetensors", "size": 4}]},
            )
        if url.endswith("/api/models/PaddlePaddle/PP-DocLayout_plus-L"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={"siblings": [{"rfilename": "config.json", "size": 4}, {"rfilename": "model.safetensors", "size": 4}]},
            )
        if url.endswith("/api/models/PaddlePaddle/PP-DocBlockLayout"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={"siblings": [{"rfilename": "config.json", "size": 4}, {"rfilename": "model.safetensors", "size": 4}]},
            )
        if url.endswith("/api/models/PaddlePaddle/PP-LCNet_x1_0_doc_ori"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={"siblings": [{"rfilename": "config.json", "size": 4}, {"rfilename": "model.safetensors", "size": 4}]},
            )
        if url.endswith("/api/models/PaddlePaddle/PP-LCNet_x1_0_textline_ori"):
            return FakeResponse(
                status=200,
                headers={"content-type": "application/json"},
                payload={"siblings": [{"rfilename": "config.json", "size": 4}, {"rfilename": "model.safetensors", "size": 4}]},
            )
        return FakeResponse(status=200, headers={"content-length": "4"}, body=[b"test"])

    manager = ModelArtifactManager(
        cache_dir=tmp_path / "cache",
        huggingface_endpoint="https://hf.example",
        fetch=fetch,
    )
    runtime_config = ModelRuntimeConfig.from_mapping(
        {
            "basePath": str(tmp_path),
            "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
            "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
            "preferredDevice": "cpu",
            "coreConfig": {
                "ocr": {
                    "provider": "local",
                    "local": {
                        "model": "PaddlePaddle/PP-OCRv4_mobile",
                    },
                },
                "caption": {"provider": "local", "local": {"model": "vikhyatk/moondream2"}},
            },
        }
    )

    result = manager.ensure_ocr_artifacts(runtime_config, on_progress=lambda downloaded, total: progress.append((downloaded, total)))

    assert result.downloaded_files == 12
    assert result.downloaded_bytes == 48
    assert result.detection_root == tmp_path / "cache" / "PaddlePaddle" / "PP-OCRv4_mobile_det"
    assert result.recognition_root == tmp_path / "cache" / "PaddlePaddle" / "PP-OCRv4_mobile_rec"
    assert result.layout_root == tmp_path / "cache" / "PaddlePaddle" / "PP-DocLayout_plus-L"
    assert result.region_root == tmp_path / "cache" / "PaddlePaddle" / "PP-DocBlockLayout"
    assert result.doc_orientation_root == tmp_path / "cache" / "PaddlePaddle" / "PP-LCNet_x1_0_doc_ori"
    assert result.textline_orientation_root == tmp_path / "cache" / "PaddlePaddle" / "PP-LCNet_x1_0_textline_ori"
    assert (result.detection_root / "config.json").read_bytes() == b"test"
    assert (result.recognition_root / "model.safetensors").read_bytes() == b"test"
    assert (result.layout_root / "config.json").read_bytes() == b"test"
    assert (result.region_root / "model.safetensors").read_bytes() == b"test"
    assert (result.doc_orientation_root / "config.json").read_bytes() == b"test"
    assert (result.textline_orientation_root / "model.safetensors").read_bytes() == b"test"
    assert progress[-1] == (48, 48)
