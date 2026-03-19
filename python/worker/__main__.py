from __future__ import annotations

import sys
from tempfile import gettempdir
from typing import Any

from worker.index.queue import IndexQueue
from worker.index.service import IndexService
from worker.model.service import ModelService
from worker.parser.service import parse_node
from worker.protocol import decode_frame, encode_frame, is_request_frame
from worker.protocol.server import create_server
from worker.runtime.status import IndexStatusStore, ModelStatusStore, VectorStatusStore
from worker.vector.repository import VectorRepository


def main() -> None:
    stdout = sys.stdout.buffer

    def emit_event(event: dict[str, Any]) -> None:
        stdout.write(encode_frame(event))
        stdout.flush()

    def log(level: str, msg: str, **fields: Any) -> None:
        record = {
            "level": level,
            "msg": msg,
            "logger": "python-worker",
            **fields,
        }
        sys.stderr.write(f"{record}\n".replace("'", '"'))
        sys.stderr.flush()

    model_status_store = ModelStatusStore(event_sink=emit_event)
    index_status_store = IndexStatusStore(event_sink=emit_event)
    vector_status_store = VectorStatusStore(event_sink=emit_event)
    model_service = ModelService(
        status_store=model_status_store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: simple_embedding_runtime,
        load_reranker_runtime=lambda: {"provider": "stub-reranker"},
    )
    index_queue = IndexQueue(status_store=index_status_store)
    index_service = IndexService(
        parse_node=parse_node,
        model_service=model_service,
        vector_repository=VectorRepository(collection_path=f"{gettempdir()}/knowdisk-python-worker.zvec"),
        vector_status_store=vector_status_store,
    )
    server = create_server(
        event_sink=emit_event,
        services={
            "model_service": model_service,
            "index_queue": index_queue,
            "index_service": index_service,
        },
    )
    log("info", "python worker started")

    while server.is_running:
        line = sys.stdin.buffer.readline()
        if not line:
            break
        try:
            frame = decode_frame(line)
        except ValueError:
            log("warn", "failed to decode worker frame")
            continue
        if not is_request_frame(frame):
            log("warn", "ignored non-request worker frame")
            continue
        log("info", "handling worker request", method=frame["method"])
        response = server.handle_request(frame)
        stdout.write(encode_frame(response))
        stdout.flush()

    log("info", "python worker stopped")


def simple_embedding_runtime(text: str) -> list[float]:
    return [float(len(text.strip()))]


if __name__ == "__main__":
    main()
