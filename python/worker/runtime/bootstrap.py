from __future__ import annotations

import sys
from dataclasses import dataclass
from tempfile import gettempdir
from typing import BinaryIO, TextIO

from worker.index.queue import IndexQueue
from worker.index.service import IndexService
from worker.model.service import ModelService
from worker.parser.service import parse_node
from worker.protocol import decode_frame, encode_frame, is_request_frame
from worker.protocol.server import PythonWorkerServer, create_server
from worker.runtime.logging import WorkerLogger, create_worker_logger
from worker.runtime.status import IndexStatusStore, ModelStatusStore, VectorStatusStore
from worker.vector.repository import VectorRepository


@dataclass(slots=True)
class WorkerRuntime:
    stdin: BinaryIO
    stdout: BinaryIO
    logger: WorkerLogger
    server: PythonWorkerServer

    def run(self) -> None:
        self.logger.log("info", "python worker started")

        while getattr(self.server, "is_running", False):
            line = self.stdin.readline()
            if not line:
                break
            try:
                frame = decode_frame(line)
            except ValueError:
                self.logger.log("warn", "failed to decode worker frame")
                continue
            if not is_request_frame(frame):
                self.logger.log("warn", "ignored non-request worker frame")
                continue
            self.logger.log("info", "handling worker request", method=frame["method"])
            response = self.server.handle_request(frame)
            self.stdout.write(encode_frame(response))
            self.stdout.flush()

        self.logger.log("info", "python worker stopped")


def main() -> None:
    runtime = create_worker_runtime(
        stdin=sys.stdin.buffer,
        stdout=sys.stdout.buffer,
        stderr=sys.stderr,
    )
    runtime.run()


def create_worker_runtime(
    *,
    stdin: BinaryIO,
    stdout: BinaryIO,
    stderr: TextIO,
) -> WorkerRuntime:
    def emit_event(event: dict[str, object]) -> None:
        stdout.write(encode_frame(event))
        stdout.flush()

    logger = create_worker_logger(stderr)
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
    return WorkerRuntime(stdin=stdin, stdout=stdout, logger=logger, server=server)


def simple_embedding_runtime(text: str) -> list[float]:
    return [float(len(text.strip()))]
