from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from inspect import Parameter, signature
from pathlib import Path
from collections.abc import Callable, Mapping
from urllib.parse import urlsplit

from worker.model.artifacts import has_complete_local_model_artifacts, select_repo_files_for_model
from worker.model.model_specs import get_model_artifact_spec, resolve_ocr_preset
from worker.model.types import ModelArtifactKind, ModelRepoFile, ModelRuntimeConfig
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


@dataclass(frozen=True)
class OcrArtifactEnsureResult:
    model_root: Path
    detection_root: Path
    recognition_root: Path
    layout_root: Path
    region_root: Path
    doc_orientation_root: Path
    textline_orientation_root: Path
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
        files = self._select_required_files(model, kind, siblings)
        if not files:
            raise ValueError(f"No required model artifacts found for {kind} model {model}")
        return files

    def resolve_model_root(self, kind: ModelArtifactKind, model: str) -> Path:
        _ = kind
        return self._cache_dir / Path(*model.split("/"))

    def resolve_ocr_model_root(self, role: str, model: str) -> Path:
        if role not in {
            "detection",
            "recognition",
            "layout",
            "region",
            "docOrientation",
            "textlineOrientation",
            "docUnwarping",
            "tableClassification",
            "wiredTableStructureRecognition",
            "wirelessTableStructureRecognition",
            "wiredTableCellsDetection",
            "wirelessTableCellsDetection",
            "formulaRecognition",
        }:
            raise ValueError(f"unknown ocr artifact role: {role}")
        return self._cache_dir / Path(*model.split("/"))

    def ensure_artifacts(
        self,
        kind: ModelArtifactKind,
        model: str,
        force_redownload: bool = False,
        on_progress: ProgressCallback | None = None,
    ) -> ModelArtifactEnsureResult:
        model_root = self.resolve_model_root(kind, model)
        return self._ensure_artifacts_to_root(
            kind=kind,
            model=model,
            model_root=model_root,
            force_redownload=force_redownload,
            on_progress=on_progress,
        )

    def ensure_ocr_artifacts(
        self,
        runtime_config: ModelRuntimeConfig,
        force_redownload: bool = False,
        on_progress: ProgressCallback | None = None,
    ) -> OcrArtifactEnsureResult:
        preset = resolve_ocr_preset(
            runtime_config.ocr_model,
            enable_table_recognition=runtime_config.ocr_enable_table_recognition,
            enable_formula_recognition=runtime_config.ocr_enable_formula_recognition,
        )
        downloads = [
            (role, model, self.resolve_model_root("ocr", model))
            for role, model in preset.items()
        ]
        total_bytes = 0
        downloaded_bytes = 0
        downloaded_files = 0

        for role, model, model_root in downloads:
            files = self._resolve_file_sizes(model, self.list_model_files("ocr", model))
            total_bytes += sum(file.size for file in files)

        for role, model, model_root in downloads:
            result = self._ensure_artifacts_to_root(
                kind="ocr",
                model=model,
                model_root=model_root,
                force_redownload=force_redownload,
                on_progress=(
                    None
                    if on_progress is None
                    else lambda current, total, file=None, target_path=None, offset=downloaded_bytes: self._notify_progress(
                        on_progress,
                        offset + current,
                        total_bytes,
                        file=file,
                        target_path=target_path,
                    )
                ),
            )
            downloaded_bytes += result.downloaded_bytes
            downloaded_files += result.downloaded_files

        if on_progress is not None:
            self._notify_progress(on_progress, downloaded_bytes, total_bytes)
        return OcrArtifactEnsureResult(
            model_root=self.resolve_model_root("ocr", runtime_config.ocr_model),
            detection_root=self.resolve_ocr_model_root("detection", runtime_config.ocr_detection_model),
            recognition_root=self.resolve_ocr_model_root("recognition", runtime_config.ocr_recognition_model),
            layout_root=self.resolve_ocr_model_root("layout", runtime_config.ocr_layout_model),
            region_root=self.resolve_ocr_model_root("region", runtime_config.ocr_region_model),
            doc_orientation_root=self.resolve_ocr_model_root("docOrientation", runtime_config.ocr_doc_orientation_model),
            textline_orientation_root=self.resolve_ocr_model_root(
                "textlineOrientation", runtime_config.ocr_textline_orientation_model
            ),
            downloaded_files=downloaded_files,
            downloaded_bytes=downloaded_bytes,
        )

    def _ensure_artifacts_to_root(
        self,
        *,
        kind: ModelArtifactKind,
        model: str,
        model_root: Path,
        force_redownload: bool,
        on_progress: ProgressCallback | None,
    ) -> ModelArtifactEnsureResult:
        spec = get_model_artifact_spec(kind, model)
        if spec.runtime_managed:
            model_root.mkdir(parents=True, exist_ok=True)
            return ModelArtifactEnsureResult(
                kind=kind,
                model=model,
                model_root=model_root,
                files=[],
                downloaded_files=0,
                downloaded_bytes=0,
            )
        if force_redownload and model_root.exists():
            self._remove_tree(model_root)
        if not force_redownload and has_complete_local_model_artifacts(kind, model_root, model=model):
            return ModelArtifactEnsureResult(
                kind=kind,
                model=model,
                model_root=model_root,
                files=[],
                downloaded_files=0,
                downloaded_bytes=0,
            )

        files = self._resolve_file_sizes(model, self.list_model_files(kind, model))
        total_bytes = sum(file.size for file in files)
        downloaded_bytes = 0

        downloaded_files = 0
        for file in files:
            destination = model_root / file.path
            file_total = file.size
            if self._is_completed_file(destination, expected_size=file_total):
                downloaded_bytes += file_total if file_total > 0 else destination.stat().st_size
                self._notify_progress(
                    on_progress,
                    downloaded_bytes,
                    total_bytes,
                    file=file.path,
                    target_path=str(destination),
                )
                continue

            def report_progress(downloaded_in_file: int, _file_total: int, *, offset: int = downloaded_bytes) -> None:
                self._notify_progress(
                    on_progress,
                    offset + downloaded_in_file,
                    total_bytes,
                    file=file.path,
                    target_path=str(destination),
                )

            download_file(
                self._model_file_url(model, file.path),
                destination,
                self._fetch,
                on_progress=report_progress,
            )
            downloaded_bytes += file_total if file_total > 0 else destination.stat().st_size
            downloaded_files += 1

        self._notify_progress(on_progress, downloaded_bytes, total_bytes)
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
        model: str,
        kind: ModelArtifactKind,
        siblings: list[Mapping[str, object]] | tuple[Mapping[str, object], ...] | list[object],
    ) -> list[ModelRepoFile]:
        return select_repo_files_for_model(kind, model, siblings)

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

    def _notify_progress(
        self,
        callback: ProgressCallback | None,
        downloaded: int,
        total: int,
        *,
        file: str | None = None,
        target_path: str | None = None,
    ) -> None:
        if callback is None:
            return
        parameters = signature(callback).parameters.values()
        accepts_metadata = any(
            parameter.kind == Parameter.VAR_KEYWORD or parameter.name in {"file", "target_path"}
            for parameter in parameters
        )
        if accepts_metadata:
            callback(downloaded, total, file=file, target_path=target_path)  # type: ignore[misc]
            return
        callback(downloaded, total)
