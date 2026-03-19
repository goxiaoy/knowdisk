from collections.abc import Callable
from typing import Any

from worker.bun_client import BunClient


class PythonWorkerServer:
    def __init__(
        self,
        event_sink: Callable[[dict[str, Any]], None],
        bun_request: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
        services: dict[str, Any] | None = None,
    ) -> None:
        self._event_sink = event_sink
        self.bun_client = BunClient(bun_request) if bun_request is not None else None
        self.services = services or {}
        self.is_running = True
        self.model_runtime_config: dict[str, Any] | None = None

    def handle_request(self, frame: dict[str, Any]) -> dict[str, Any]:
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

    def _handle_start(self, params: dict[str, Any]) -> dict[str, Any]:
        self.model_runtime_config = self._parse_model_runtime_config(params)
        model_service = self.services.get("model_service")
        if model_service is not None:
            model_service.ensure_required_models()
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

    def _handle_shutdown(self, params: dict[str, Any]) -> dict[str, Any]:
        _ = params
        self.is_running = False
        return {"ok": True}

    def _handle_get_status_snapshot(self, params: dict[str, Any]) -> dict[str, Any]:
        _ = params
        model_service = self.services["model_service"]
        index_queue = self.services["index_queue"]
        index_service = self.services["index_service"]
        return {
            "model_status": model_service.snapshot(),
            "index_status": index_queue.snapshot(),
            "vector_status": index_service.vector_status_snapshot(),
        }

    def _handle_index_node(self, params: dict[str, Any]) -> dict[str, Any]:
        result: dict[str, Any] = {"indexed": 0}

        def job() -> None:
            nonlocal result
            result = self.services["index_service"].index_node(params["node"], params["mount"])

        self.services["index_queue"].enqueue_incremental(params["node"]["name"], job)
        return result

    def _handle_delete_node(self, params: dict[str, Any]) -> dict[str, Any]:
        self.services["index_service"].delete_node(params["nodeId"])
        return {"ok": True}

    def _handle_search(self, params: dict[str, Any]) -> list[dict[str, Any]]:
        return self.services["index_service"].search(str(params.get("query", "")))

    def _parse_model_runtime_config(self, params: dict[str, Any]) -> dict[str, Any]:
        required_fields = ("embeddingModel", "rerankerModel", "preferredDevice", "modelCacheDir")
        if not all(isinstance(params.get(field), str) and params[field].strip() for field in required_fields):
            raise ValueError("missing required model runtime configuration")

        preferred_device = str(params["preferredDevice"])
        if preferred_device not in {"cpu", "mps", "cuda"}:
            raise ValueError(f"invalid preferred device: {preferred_device}")

        config = {
            "embeddingModel": str(params["embeddingModel"]),
            "rerankerModel": str(params["rerankerModel"]),
            "preferredDevice": preferred_device,
            "modelCacheDir": str(params["modelCacheDir"]),
        }
        huggingface_endpoint = params.get("huggingfaceEndpoint")
        if huggingface_endpoint is not None:
            if not isinstance(huggingface_endpoint, str) or not huggingface_endpoint.strip():
                raise ValueError("invalid huggingface endpoint")
            config["huggingfaceEndpoint"] = huggingface_endpoint

        return config


def create_server(
    event_sink: Callable[[dict[str, Any]], None],
    bun_request: Callable[[str, dict[str, Any]], dict[str, Any]] | None = None,
    services: dict[str, Any] | None = None,
) -> PythonWorkerServer:
    return PythonWorkerServer(event_sink=event_sink, bun_request=bun_request, services=services)
