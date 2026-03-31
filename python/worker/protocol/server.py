import importlib
import os
from collections.abc import Callable, Mapping
from dataclasses import replace
from pathlib import Path

from worker.model.artifact_manager import FetchCallable, ModelArtifactManager
from worker.model.types import ModelRuntimeConfig
from worker.runtime.types import (
    DeleteNodeRequest,
    IndexNodeRequest,
    SearchRequest,
    SearchResponsePayload,
    WorkerServices,
    WorkerServicesBundle,
    coerce_worker_services,
)


class PythonWorkerServer:
    def __init__(
        self,
        event_sink: Callable[[dict[str, object]], None],
        services: WorkerServices | dict[str, object] | None = None,
        model_fetch: FetchCallable | None = None,
    ) -> None:
        self._event_sink = event_sink
        self.services = coerce_worker_services(services) if services is not None else None
        self._model_fetch = model_fetch
        self.is_running = True
        self.model_runtime_config: ModelRuntimeConfig | None = None

    def handle_request(self, frame: Mapping[str, object]) -> dict[str, object]:
        request_id = frame["id"]
        method = frame["method"]
        params = frame.get("params", {})

        handlers = {
            "start": self._handle_start,
            "shutdown": self._handle_shutdown,
            "get_status_snapshot": self._handle_get_status_snapshot,
            "index_node": self._handle_index_node,
            "delete_node": self._handle_delete_node,
            "search": self._handle_search,
        }
        handler = handlers.get(method)
        if handler is None:
            return {
                "id": request_id,
                "error": {
                    "code": "METHOD_NOT_FOUND",
                    "message": f"Unknown method: {method}",
                },
            }

        if method == "start":
            try:
                return {
                    "id": request_id,
                    "result": handler(params),
                }
            except ValueError as error:
                return {
                    "id": request_id,
                    "error": {
                        "code": "INVALID_PARAMS",
                        "message": str(error),
                    },
                }

        return {
            "id": request_id,
            "result": handler(params),
        }

    def _handle_start(self, params: object) -> dict[str, object]:
        self.model_runtime_config = self._parse_model_runtime_config(params)
        _configure_model_runtime_cache(
            self.model_runtime_config.base_path,
            huggingface_endpoint=self.model_runtime_config.huggingface_endpoint or "https://huggingface.co",
        )
        if self.services is not None:
            if self._model_fetch is None:
                raise RuntimeError("model fetch is not configured")
            artifact_manager = ModelArtifactManager(
                cache_dir=self.model_runtime_config.model_cache_dir,
                huggingface_endpoint=self.model_runtime_config.huggingface_endpoint or "https://huggingface.co",
                fetch=self._model_fetch,
            )
            self.services.model_service.configure_runtime(
                self.model_runtime_config,
                artifact_manager=artifact_manager,
            )
            if hasattr(self.services.index_queue, "set_storage_base_path"):
                self.services.index_queue.set_storage_base_path(
                    self.model_runtime_config.base_path
                )
            if hasattr(self.services.index_service, "set_storage_base_path"):
                self.services.index_service.set_storage_base_path(
                    self.model_runtime_config.base_path
                )
            self.services.model_service.start_required_models()
        self._event_sink(
            {
                "type": "worker_health_changed",
                "payload": {
                    "ready": True,
                },
            }
        )
        return {
            "ok": True,
            "worker": "knowdisk-python-worker",
            "version": "0.1.0",
        }

    def _handle_shutdown(self, params: object) -> dict[str, object]:
        _ = params
        self.is_running = False
        return {"ok": True}

    def _handle_get_status_snapshot(self, params: object) -> dict[str, object]:
        _ = params
        services = self._require_services()
        return {
            "model_status": services.model_service.snapshot(),
            "index_status": services.index_queue.snapshot(),
            "vector_status": services.index_service.vector_status_snapshot(),
        }

    def _handle_index_node(self, params: object) -> dict[str, object]:
        request = IndexNodeRequest.from_mapping(_as_mapping(params))
        services = self._require_services()
        services.index_queue.enqueue_incremental(request)
        return {"queued": True}

    def _handle_delete_node(self, params: object) -> dict[str, object]:
        services = self._require_services()
        request = DeleteNodeRequest.from_mapping(_as_mapping(params))
        services.index_queue.enqueue_delete(request)
        return {"ok": True}

    def _handle_search(self, params: object) -> SearchResponsePayload:
        services = self._require_services()
        request = SearchRequest.from_mapping(_as_mapping(params))
        return services.index_service.search(request.query, title_only=request.title_only)

    def _parse_model_runtime_config(self, params: object) -> ModelRuntimeConfig:
        if not isinstance(params, Mapping):
            raise ValueError("missing required model runtime configuration")

        required_fields = ("basePath", "embeddingModel", "rerankerModel", "preferredDevice")
        if not all(isinstance(params.get(field), str) and params[field].strip() for field in required_fields):
            raise ValueError("missing required model runtime configuration")

        preferred_device = str(params["preferredDevice"])
        if preferred_device not in {"cpu", "mps", "cuda"}:
            raise ValueError(f"invalid preferred device: {preferred_device}")

        config = ModelRuntimeConfig.from_mapping(params)
        huggingface_endpoint = params.get("huggingfaceEndpoint")
        if huggingface_endpoint is not None:
            if not isinstance(huggingface_endpoint, str) or not huggingface_endpoint.strip():
                raise ValueError("invalid huggingface endpoint")
            config = replace(config, huggingface_endpoint=huggingface_endpoint)

        return config

    def _require_services(self) -> WorkerServicesBundle:
        if self.services is None:
            raise RuntimeError("worker services are not attached")
        return self.services


def create_server(
    event_sink: Callable[[dict[str, object]], None],
    services: WorkerServices | dict[str, object] | None = None,
    model_fetch: FetchCallable | None = None,
) -> PythonWorkerServer:
    return PythonWorkerServer(event_sink=event_sink, services=services, model_fetch=model_fetch)


def _as_mapping(value: object) -> Mapping[str, object]:
    if not isinstance(value, Mapping):
        raise ValueError("request params must be a mapping")
    return value


def _configure_model_runtime_cache(base_path: Path, *, huggingface_endpoint: str) -> None:
    hf_home = base_path / "huggingface"
    hf_modules_cache = hf_home / "modules"
    transformers_cache = hf_home / "hub"
    paddlex_cache = base_path / "paddlex"
    paddlex_official_models = paddlex_cache / "official_models"

    hf_home.mkdir(parents=True, exist_ok=True)
    hf_modules_cache.mkdir(parents=True, exist_ok=True)
    transformers_cache.mkdir(parents=True, exist_ok=True)
    paddlex_cache.mkdir(parents=True, exist_ok=True)
    paddlex_official_models.mkdir(parents=True, exist_ok=True)

    os.environ["HF_HOME"] = str(hf_home)
    os.environ["HF_MODULES_CACHE"] = str(hf_modules_cache)
    os.environ["TRANSFORMERS_CACHE"] = str(transformers_cache)
    os.environ["PADDLE_PDX_CACHE_HOME"] = str(paddlex_cache)
    os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] = "True"
    os.environ["PADDLE_PDX_MODEL_SOURCE"] = "huggingface"
    os.environ["PADDLE_PDX_HUGGING_FACE_ENDPOINT"] = huggingface_endpoint

    try:
        transformers_utils = importlib.import_module("transformers.utils")
    except ImportError:
        return

    setattr(transformers_utils, "HF_MODULES_CACHE", str(hf_modules_cache))
    setattr(transformers_utils, "TRANSFORMERS_CACHE", str(transformers_cache))

    try:
        dynamic_module_utils = importlib.import_module("transformers.dynamic_module_utils")
    except ImportError:
        dynamic_module_utils = None

    if dynamic_module_utils is not None:
        setattr(dynamic_module_utils, "HF_MODULES_CACHE", str(hf_modules_cache))

    try:
        paddlex_cache_module = importlib.import_module("paddlex.utils.cache")
    except ImportError:
        paddlex_cache_module = None

    if paddlex_cache_module is not None:
        setattr(paddlex_cache_module, "CACHE_DIR", str(paddlex_cache))
        setattr(paddlex_cache_module, "FUNC_CACHE_DIR", str(paddlex_cache / "func_ret"))
        setattr(paddlex_cache_module, "FILE_LOCK_DIR", str(paddlex_cache / "locks"))
        setattr(paddlex_cache_module, "TEMP_DIR", str(paddlex_cache / "temp"))

    try:
        paddlex_flags_module = importlib.import_module("paddlex.utils.flags")
    except ImportError:
        paddlex_flags_module = None

    if paddlex_flags_module is not None:
        setattr(paddlex_flags_module, "MODEL_SOURCE", "huggingface")
        setattr(paddlex_flags_module, "DISABLE_MODEL_SOURCE_CHECK", True)
        setattr(paddlex_flags_module, "HUGGING_FACE_ENDPOINT", huggingface_endpoint)

    importlib.invalidate_caches()
