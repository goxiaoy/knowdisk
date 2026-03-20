from __future__ import annotations

import json
import os
import sys
import threading
import time
from urllib.request import Request, urlopen
from dataclasses import dataclass
from collections.abc import Iterable
from pathlib import Path
from tempfile import gettempdir
from typing import BinaryIO, Callable, TextIO

from worker.index.queue import IndexQueue
from worker.index.service import IndexService
from worker.model.service import ModelService
from worker.parser.service import parse_node
from worker.protocol import decode_frame, encode_frame, is_request_frame
from worker.protocol.server import PythonWorkerServer, create_server
from worker.runtime.logging import WorkerLogger, create_worker_logger
from worker.runtime.status import IndexStatusStore, ModelStatusStore, VectorStatusStore
from worker.runtime.types import DeleteNodeRequest, IndexNodeRequest
from worker.vector.repository import VectorRepository

_FAKE_MODEL_RUNTIME_ENV = "KNOWDISK_PYTHON_FAKE_MODEL_RUNTIME"


@dataclass(slots=True)
class WorkerRuntime:
    stdin: BinaryIO
    stdout: BinaryIO
    logger: WorkerLogger
    server: PythonWorkerServer
    start_index_worker: Callable[[], None]
    stop_index_worker: Callable[[], None]

    def run(self) -> None:
        self.logger.log("info", "python worker started")

        try:
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
                self.logger.log(
                    "info",
                    "handling worker request",
                    method=frame["method"],
                    params=frame.get("params"),
                )
                response = self.server.handle_request(frame)
                self.stdout.write(encode_frame(response))
                self.stdout.flush()
                if frame["method"] == "start":
                    self.start_index_worker()
        finally:
            self.stop_index_worker()
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
    use_fake_model_runtime = os.environ.get(_FAKE_MODEL_RUNTIME_ENV) == "1"

    def emit_event(event: dict[str, object]) -> None:
        stdout.write(encode_frame(event))
        stdout.flush()

    logger = create_worker_logger(stderr)
    model_status_store = ModelStatusStore(event_sink=emit_event)
    index_status_store = IndexStatusStore(event_sink=emit_event)
    vector_status_store = VectorStatusStore(event_sink=emit_event)
    default_base_path = Path(gettempdir()) / "knowdisk-python-worker"
    work_available = threading.Event()
    model_service = ModelService(
        status_store=model_status_store,
        embedding_runtime_loader=_fake_embedding_runtime_loader if use_fake_model_runtime else None,
        reranker_runtime_loader=_fake_reranker_runtime_loader if use_fake_model_runtime else None,
        logger=logger,
    )
    index_queue = IndexQueue(
        status_store=index_status_store,
        notify_work_available=work_available.set,
    )
    index_service = IndexService(
        parse_node=parse_node,
        model_service=model_service,
        vector_repository=VectorRepository(collection_path=str(default_base_path / "index" / "index.zvec")),
        vector_status_store=vector_status_store,
        parser_base_dir=default_base_path / "parser",
    )
    server = create_server(
        event_sink=emit_event,
        services={
            "model_service": model_service,
            "index_queue": index_queue,
            "index_service": index_service,
        },
        model_fetch=fake_model_fetch if use_fake_model_runtime else fetch_model_http,
    )
    start_index_worker, stop_index_worker = _create_index_worker_controls(
        index_queue=index_queue,
        index_service=index_service,
        server=server,
        logger=logger,
        work_available=work_available,
    )
    return WorkerRuntime(
        stdin=stdin,
        stdout=stdout,
        logger=logger,
        server=server,
        start_index_worker=start_index_worker,
        stop_index_worker=stop_index_worker,
    )


def _create_index_worker_controls(
    *,
    index_queue: IndexQueue,
    index_service: IndexService,
    server: PythonWorkerServer,
    logger: WorkerLogger,
    work_available: threading.Event,
) -> tuple[Callable[[], None], Callable[[], None]]:
    stop_event = threading.Event()
    thread_guard = threading.Lock()
    thread: threading.Thread | None = None

    def worker_loop() -> None:
        index_queue.requeue_orphaned_running_jobs()
        work_available.set()
        while not stop_event.is_set() and getattr(server, "is_running", False):
            work_available.wait(timeout=0.25)
            work_available.clear()
            while not stop_event.is_set() and getattr(server, "is_running", False):
                job = index_queue.claim_next_job()
                if job is None:
                    break
                try:
                    _run_queue_job(job, index_service=index_service)
                except BaseException as exc:
                    index_queue.mark_failed(job.job_id, str(exc))
                    logger.log(
                        "error",
                        "index worker job failed",
                        jobId=job.job_id,
                        jobType=job.job_type,
                        nodeId=job.node_id,
                        error=str(exc),
                    )
                else:
                    index_queue.mark_done(job.job_id)
            time.sleep(0)

    def start() -> None:
        nonlocal thread
        with thread_guard:
            if thread is not None and thread.is_alive():
                return
            stop_event.clear()
            thread = threading.Thread(target=worker_loop, daemon=True, name="index-worker")
            thread.start()

    def stop() -> None:
        stop_event.set()
        work_available.set()
        with thread_guard:
            if thread is not None and thread.is_alive():
                thread.join(timeout=1)

    return start, stop


def _run_queue_job(job, *, index_service: IndexService) -> None:
    payload = json.loads(job.payload_json)
    if not isinstance(payload, dict):
        raise ValueError(f"invalid job payload for job {job.job_id}")
    if job.job_type == "index":
        index_service.index_node(IndexNodeRequest.from_mapping(payload))
        return
    if job.job_type == "delete":
        request = DeleteNodeRequest.from_mapping(payload)
        index_service.delete_node(request.node_id)
        return
    raise ValueError(f"unsupported job type: {job.job_type}")

class FetchResponse:
    def __init__(self, *, status: int, headers: dict[str, str], body: Iterable[bytes]) -> None:
        self.status = status
        self.headers = headers
        self.body = body

    def json(self) -> object:
        import json

        return json.loads(b"".join(self.body).decode("utf-8"))


class StreamingResponseBody:
    def __init__(self, response) -> None:
        self._response = response

    def __iter__(self):
        try:
            yield from self._response
        finally:
            close = getattr(self._response, "close", None)
            if callable(close):
                close()


def fetch_model_http(url: str, headers: dict[str, str] | None = None) -> FetchResponse:
    request = Request(url, headers=headers or {})
    response = urlopen(request)
    return FetchResponse(
        status=getattr(response, "status", response.getcode()),
        headers={str(key): str(value) for key, value in response.headers.items()},
        body=StreamingResponseBody(response),
    )


def fake_model_fetch(url: str, headers: dict[str, str] | None = None) -> FetchResponse:
    _ = headers
    if "/api/models/" in url:
        model = url.rsplit("/api/models/", 1)[1]
        siblings = _fake_model_siblings(model)
        body = (
            '{"siblings":['
            + ",".join(
                f'{{"rfilename":"{path}","size":{len(contents)}}}'
                for path, contents in siblings.items()
            )
            + "]}"
        ).encode("utf-8")
        return FetchResponse(
            status=200,
            headers={"content-length": str(len(body))},
            body=[body],
        )

    if "/resolve/main/" not in url:
        return FetchResponse(status=404, headers={"content-length": "0"}, body=[])

    model_and_path = url.rsplit("/", 1)[0]
    model = model_and_path.split("/")[-3] + "/" + model_and_path.split("/")[-2]
    artifact_path = url.rsplit("/resolve/main/", 1)[1]
    contents = _fake_model_siblings(model).get(artifact_path)
    if contents is None:
        return FetchResponse(status=404, headers={"content-length": "0"}, body=[])
    return FetchResponse(
        status=200,
        headers={"content-length": str(len(contents))},
        body=[contents],
    )


def _fake_model_siblings(model: str) -> dict[str, bytes]:
    if model.endswith("reranker-base"):
        return {
            "config.json": b"{}",
            "tokenizer.json": b"{}",
            "tokenizer_config.json": b"{}",
            "special_tokens_map.json": b"{}",
            "model.safetensors": b"fake-reranker-weights",
        }
    return {
        "config.json": b"{}",
        "config_sentence_transformers.json": b"{}",
        "modules.json": b"[]",
        "tokenizer.json": b"{}",
        "tokenizer_config.json": b"{}",
        "special_tokens_map.json": b"{}",
        "sentence_bert_config.json": b"{}",
        "1_Pooling/config.json": b"{}",
        "model.safetensors": b"fake-embedding-weights",
    }


def _fake_embedding_runtime_loader(model_path, *, preferred_device: str) -> object:
    _ = model_path
    _ = preferred_device

    def embed(text: str) -> list[float]:
        return [float(len(text))]

    return embed


def _fake_reranker_runtime_loader(model_path, *, preferred_device: str) -> object:
    _ = model_path
    _ = preferred_device

    def rerank(query: str, candidate: dict[str, object]) -> float:
        haystack = f'{candidate.get("title", "")}\n{candidate.get("text", "")}'.lower()
        return 100.0 if query.lower() in haystack else 0.0

    return rerank
