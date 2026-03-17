from collections.abc import Callable
from typing import Any


class PythonWorkerServer:
    def __init__(self, event_sink: Callable[[dict[str, Any]], None]) -> None:
        self._event_sink = event_sink
        self.is_running = True

    def handle_request(self, frame: dict[str, Any]) -> dict[str, Any]:
        request_id = frame["id"]
        method = frame["method"]
        params = frame.get("params", {})

        handlers = {
            "start": self._handle_start,
            "shutdown": self._handle_shutdown,
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

        return {
            "id": request_id,
            "result": handler(params),
        }

    def _handle_start(self, params: dict[str, Any]) -> dict[str, Any]:
        _ = params
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


def create_server(event_sink: Callable[[dict[str, Any]], None]) -> PythonWorkerServer:
    return PythonWorkerServer(event_sink=event_sink)
