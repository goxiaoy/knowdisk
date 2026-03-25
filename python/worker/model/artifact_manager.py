from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from collections.abc import Callable, Mapping
from urllib.parse import urlsplit

from worker.model.artifacts import (
    select_caption_repo_files,
    select_embedding_repo_files,
    select_ocr_repo_files,
    select_reranker_repo_files,
)
from worker.model.types import ModelArtifactKind, ModelRepoFile
from worker.model.download import download_file
ProgressCallback = Callable[[int, int], None]
FetchCallable = Callable[[str, dict[str, str] | None], object]


@dataclass(frozen=True)
class ModelArtifactEnsureResult:
    kind: ModelArtifactKind
    model: str
    model_root: Path
    files: list[ModelRepoFile]
    downloaded_files: int
    downloaded_bytes: int


class ModelArtifactManager:
    def __init__(
        self,
        cache_dir: str | Path,
        huggingface_endpoint: str,
        fetch: FetchCallable,
    ) -> None:
        self._cache_dir = Path(cache_dir)
        self._huggingface_endpoint = huggingface_endpoint.rstrip("/")
        self._fetch = fetch

    def list_model_files(self, kind: ModelArtifactKind, model: str) -> list[ModelRepoFile]:
        url = self._model_list_url(model)
        response = self._fetch_with_context(url, None)
        self._require_status(response, 200, f"Failed to list model files for {model}")
        payload = self._read_json(response)
        siblings = payload.get("siblings", []) if isinstance(payload, Mapping) else []
        files = self._select_required_files(kind, siblings)
        if not files:
            raise ValueError(f"No required model artifacts found for {kind} model {model}")
        return files

    def resolve_model_root(self, kind: ModelArtifactKind, model: str) -> Path:
        return self._cache_dir / kind / Path(*model.split("/"))

    def ensure_artifacts(
        self,
        kind: ModelArtifactKind,
        model: str,
        force_redownload: bool = False,
        on_progress: ProgressCallback | None = None,
    ) -> ModelArtifactEnsureResult:
        model_root = self.resolve_model_root(kind, model)
        if force_redownload and model_root.exists():
            self._remove_tree(model_root)

        files = self._resolve_file_sizes(model, self.list_model_files(kind, model))
        total_bytes = sum(file.size for file in files)
        downloaded_bytes = 0

        downloaded_files = 0
        for file in files:
            destination = model_root / file.path
            file_total = file.size
            if self._is_completed_file(destination, expected_size=file_total):
                downloaded_bytes += file_total if file_total > 0 else destination.stat().st_size
                if on_progress is not None:
                    on_progress(downloaded_bytes, total_bytes)
                continue

            def report_progress(downloaded_in_file: int, _file_total: int, *, offset: int = downloaded_bytes) -> None:
                if on_progress is not None:
                    on_progress(offset + downloaded_in_file, total_bytes)

            download_file(
                self._model_file_url(model, file.path),
                destination,
                self._fetch,
                on_progress=report_progress,
            )
            downloaded_bytes += file_total if file_total > 0 else destination.stat().st_size
            downloaded_files += 1

        if on_progress is not None:
            on_progress(downloaded_bytes, total_bytes)
        return ModelArtifactEnsureResult(
            kind=kind,
            model=model,
            model_root=model_root,
            files=files,
            downloaded_files=downloaded_files,
            downloaded_bytes=downloaded_bytes,
        )

    def _select_required_files(
        self,
        kind: ModelArtifactKind,
        siblings: list[Mapping[str, object]] | tuple[Mapping[str, object], ...] | list[object],
    ) -> list[ModelRepoFile]:
        if kind == "embedding":
            return select_embedding_repo_files(siblings)
        if kind == "reranker":
            return select_reranker_repo_files(siblings)
        if kind == "ocr":
            return select_ocr_repo_files(siblings)
        if kind == "caption":
            return select_caption_repo_files(siblings)
        raise ValueError(f"unknown model artifact kind: {kind}")

    def _model_list_url(self, model: str) -> str:
        return f"{self._huggingface_endpoint}/api/models/{model}"

    def _model_file_url(self, model: str, path: str) -> str:
        return f"{self._huggingface_endpoint}/{model}/resolve/main/{path}"

    def _read_json(self, response: object) -> dict[str, object]:
        json_method = getattr(response, "json", None)
        if callable(json_method):
            payload = json_method()
            if isinstance(payload, dict):
                return payload
            raise ValueError("model listing response is not a json object")

        body = getattr(response, "body", None)
        if body is None:
            raise ValueError("model listing response is missing a body")
        if isinstance(body, (bytes, bytearray)):
            return json.loads(body.decode("utf-8"))
        if isinstance(body, list):
            return json.loads(b"".join(body).decode("utf-8"))
        raise ValueError("model listing response is not readable")

    def _require_status(self, response: object, expected: int, message: str) -> None:
        status = getattr(response, "status", None)
        if status != expected:
            raise ValueError(f"{message}: status {status}")

    def _remove_tree(self, path: Path) -> None:
        if path.exists():
            shutil.rmtree(path)

    def _is_completed_file(self, path: Path, *, expected_size: int) -> bool:
        if not path.is_file():
            return False
        if path.with_name(f"{path.name}.part").exists():
            return False
        if expected_size <= 0:
            return False
        return path.stat().st_size == expected_size

    def _resolve_file_sizes(self, model: str, files: list[ModelRepoFile]) -> list[ModelRepoFile]:
        resolved: list[ModelRepoFile] = []
        for file in files:
            if file.size > 0:
                resolved.append(file)
                continue
            resolved.append(ModelRepoFile(path=file.path, size=self._probe_file_size(model, file.path)))
        return resolved

    def _probe_file_size(self, model: str, path: str) -> int:
        url = self._model_file_url(model, path)
        response = self._fetch_with_context(
            url,
            {"Range": "bytes=0-0"},
        )
        status = getattr(response, "status", None)
        if status == 206:
            headers = getattr(response, "headers", {})
            content_range = None
            if isinstance(headers, Mapping):
                for key, value in headers.items():
                    if isinstance(key, str) and key.lower() == "content-range" and isinstance(value, str):
                        content_range = value
                        break
            if isinstance(content_range, str):
                try:
                    _unit_range, total_text = content_range.rsplit("/", 1)
                    total = int(total_text)
                except (TypeError, ValueError):
                    total = 0
                if total > 0:
                    return total

        headers = getattr(response, "headers", {})
        if isinstance(headers, Mapping):
            for key, value in headers.items():
                if isinstance(key, str) and key.lower() == "content-length" and isinstance(value, str):
                    try:
                        total = int(value)
                    except ValueError:
                        total = 0
                    if total > 0:
                        return total
        return 0

    def _fetch_with_context(self, url: str, headers: dict[str, str] | None) -> object:
        try:
            return self._fetch(url, headers)
        except Exception as error:
            parsed = urlsplit(url)
            endpoint = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
            details = [f"failed to fetch {url}"]
            if endpoint:
                details.append(f"endpoint={endpoint}")
            if parsed.netloc:
                details.append(f"host={parsed.netloc}")
            details.append(str(error))
            raise ValueError(": ".join(details)) from error
