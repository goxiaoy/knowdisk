from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Literal

from worker.model_artifacts import select_embedding_repo_files, select_reranker_repo_files
from worker.model_download import download_file

ModelArtifactKind = Literal["embedding", "reranker"]
ProgressCallback = Callable[[int, int], None]
FetchCallable = Callable[[str, dict[str, str] | None], Any]


@dataclass(frozen=True)
class ModelArtifactEnsureResult:
    kind: ModelArtifactKind
    model: str
    model_root: Path
    files: list[str]
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

    def list_model_files(self, kind: ModelArtifactKind, model: str) -> list[dict[str, Any]]:
        response = self._fetch(self._model_list_url(model), None)
        self._require_status(response, 200, f"Failed to list model files for {model}")
        payload = self._read_json(response)
        siblings = payload.get("siblings", []) if isinstance(payload, dict) else []
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

        files = self.list_model_files(kind, model)
        total_bytes = sum(file["size"] for file in files)
        downloaded_bytes = 0

        downloaded_files = 0
        for file in files:
            destination = model_root / file["path"]
            file_total = file["size"]

            def report_progress(downloaded_in_file: int, _file_total: int, *, offset: int = downloaded_bytes) -> None:
                if on_progress is not None:
                    on_progress(offset + downloaded_in_file, total_bytes)

            download_file(
                self._model_file_url(model, file["path"]),
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
            files=[file["path"] for file in files],
            downloaded_files=downloaded_files,
            downloaded_bytes=downloaded_bytes,
        )

    def _select_required_files(
        self,
        kind: ModelArtifactKind,
        siblings: list[dict[str, Any]] | tuple[dict[str, Any], ...] | list[Any],
    ) -> list[dict[str, Any]]:
        if kind == "embedding":
            return select_embedding_repo_files(siblings)
        return select_reranker_repo_files(siblings)

    def _model_list_url(self, model: str) -> str:
        return f"{self._huggingface_endpoint}/api/models/{model}"

    def _model_file_url(self, model: str, path: str) -> str:
        return f"{self._huggingface_endpoint}/{model}/resolve/main/{path}"

    def _read_json(self, response: Any) -> dict[str, Any]:
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

    def _require_status(self, response: Any, expected: int, message: str) -> None:
        status = getattr(response, "status", None)
        if status != expected:
            raise ValueError(f"{message}: status {status}")

    def _remove_tree(self, path: Path) -> None:
        if path.exists():
            shutil.rmtree(path)
