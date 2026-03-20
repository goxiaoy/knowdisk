from __future__ import annotations

from datetime import datetime, timezone
from collections.abc import Callable, Mapping
from inspect import Parameter, signature
from pathlib import Path
import shutil
from time import perf_counter

from worker.index.chunk_store import SQLiteChunkStore
from worker.index.search_service import SearchService
from worker.parser.service import is_docling_suffix, resolve_local_source_path
from worker.runtime.status import VectorStatusStore
from worker.runtime.logging import WorkerLogger, get_process_rss_mb
from worker.runtime.types import (
    IndexNodeRequest,
    IndexNodeResult,
    SearchResponsePayload,
    coerce_index_node_request,
)
from worker.vector.repository import VectorRepository
from worker.vector.types import VectorChunkRow, VectorRowEmbedding


Parser = Callable[[object, object], list[dict[str, object]]]


class IndexService:
    def __init__(
        self,
        parse_node: Parser,
        model_service: object,
        vector_repository: VectorRepository,
        vector_status_store: VectorStatusStore,
        parser_base_dir: Path,
        chunk_store: SQLiteChunkStore | None = None,
        logger: WorkerLogger | None = None,
    ) -> None:
        self._parse_node = parse_node
        self._model_service = model_service
        self._vector_repository = vector_repository
        self._chunk_store = (
            chunk_store
            if chunk_store is not None
            else SQLiteChunkStore(parser_base_dir.parent / "index" / "index.sqlite3")
        )
        self._search_service = SearchService(
            chunk_store=self._chunk_store,
            vector_repository=self._vector_repository,
        )
        self._vector_status_store = vector_status_store
        self._parser_base_dir = parser_base_dir
        self._logger = logger
        parameters = signature(parse_node).parameters.values()
        self._parse_node_accepts_logger = any(
            parameter.kind == Parameter.VAR_KEYWORD or parameter.name == "logger"
            for parameter in parameters
        )
        self._search_rows: list[dict[str, object]] = []
        self._refresh_vector_status()

    def index_node(
        self,
        request: IndexNodeRequest | Mapping[str, object],
    ) -> IndexNodeResult:
        parsed_request = coerce_index_node_request(request)
        source_path = resolve_local_source_path(
            synced_content_path=parsed_request.mount.synced_content_path,
            local_file_path=parsed_request.mount.local_file_path,
        )
        suffix = Path(parsed_request.node.name).suffix.lower()
        parser_kind = "docling" if is_docling_suffix(suffix) else "simple"
        size_bytes = source_path.stat().st_size if source_path.exists() else 0
        parse_started_at = perf_counter()
        self._log_stage(
            "index parse started",
            name=parsed_request.node.name,
            suffix=suffix,
            parserKind=parser_kind,
            sourcePath=str(source_path),
            sizeBytes=size_bytes,
            rssMb=get_process_rss_mb(),
        )
        if self._parse_node_accepts_logger:
            chunks = self._parse_node(parsed_request.node, parsed_request.mount, logger=self._logger)
        else:
            chunks = self._parse_node(parsed_request.node, parsed_request.mount)
        self._log_stage(
            "index parse finished",
            name=parsed_request.node.name,
            suffix=suffix,
            parserKind=parser_kind,
            sourcePath=str(source_path),
            sizeBytes=size_bytes,
            durationMs=int((perf_counter() - parse_started_at) * 1000),
            chunkCount=sum(1 for chunk in chunks if chunk["status"] == "ok"),
            rssMb=get_process_rss_mb(),
        )
        self._persist_markdown_artifact(parsed_request.node.node_id, chunks)
        embedding_runtime = self._model_service.get_local_embedding_runtime()
        rows: list[VectorChunkRow] = []

        embedding_started_at = perf_counter()
        self._log_stage(
            "index embedding started",
            name=parsed_request.node.name,
            suffix=suffix,
            parserKind=parser_kind,
            chunkCount=sum(1 for chunk in chunks if chunk["status"] == "ok"),
            rssMb=get_process_rss_mb(),
        )
        for chunk in chunks:
            if chunk["status"] != "ok":
                continue
            row = VectorChunkRow(
                chunk_id=f'{parsed_request.node.node_id}:{chunk["chunkIndex"]}',
                node_id=parsed_request.node.node_id,
                mount_id=parsed_request.node.mount_id,
                source_ref=parsed_request.node.source_ref,
                name=parsed_request.node.name,
                title=str(chunk.get("title") or ""),
                text=str(chunk["text"]),
                embedding=VectorRowEmbedding.from_iterable(embedding_runtime(chunk["text"])),
            )
            rows.append(row)
        self._log_stage(
            "index embedding finished",
            name=parsed_request.node.name,
            suffix=suffix,
            parserKind=parser_kind,
            rowCount=len(rows),
            durationMs=int((perf_counter() - embedding_started_at) * 1000),
            rssMb=get_process_rss_mb(),
        )

        self._vector_repository.delete_by_node_id(parsed_request.node.node_id)
        self._chunk_store.delete_by_node_id(parsed_request.node.node_id)
        self._vector_repository.upsert_chunks(rows)
        self._chunk_store.upsert_chunks(rows)
        self._search_rows = [
            row for row in self._search_rows if row["nodeId"] != parsed_request.node.node_id
        ]
        self._search_rows.extend(row.to_legacy_dict() for row in rows)
        self._vector_status_store.update(
            chunkCount=self._vector_repository.count_chunks(),
            lastUpdatedAt=now_iso(),
            error="",
        )
        return IndexNodeResult(indexed=len(rows))

    def delete_node(self, node_id: str) -> None:
        self._vector_repository.delete_by_node_id(node_id)
        self._chunk_store.delete_by_node_id(node_id)
        artifact_dir = self._parser_base_dir / node_id
        if artifact_dir.exists():
            shutil.rmtree(artifact_dir)
        self._search_rows = [row for row in self._search_rows if row["nodeId"] != node_id]
        self._vector_status_store.update(
            chunkCount=self._vector_repository.count_chunks(),
            lastUpdatedAt=now_iso(),
            error="",
        )

    def search(self, query: str, title_only: bool = False) -> SearchResponsePayload:
        normalized = query.strip().lower()
        if not normalized:
            return {
                "query": query,
                "titleOnly": title_only,
                "debug": {
                    "ftsResults": [],
                    "vectorResults": [],
                    "mergedCandidates": [],
                    "rerankedResults": [],
                    "finalResults": [],
                },
            }
        embedding_runtime = self._model_service.get_local_embedding_runtime()
        reranker_runtime = (
            self._model_service.get_local_reranker_runtime()
            if hasattr(self._model_service, "get_local_reranker_runtime")
            else None
        )
        query_embedding = tuple(float(value) for value in embedding_runtime(query))
        return self._search_service.search(
            query=query,
            query_embedding=query_embedding,
            reranker_runtime=reranker_runtime,
            title_only=title_only,
            limit=10,
        )

    def vector_status_snapshot(self) -> dict[str, object]:
        return self._vector_status_store.snapshot()

    def set_storage_base_path(self, base_path: Path) -> None:
        next_collection_path = str(base_path / "index" / "index.zvec")
        if self._vector_repository.collection_path == next_collection_path:
            self._parser_base_dir = base_path / "parser"
            return

        self._vector_repository.close()
        self._parser_base_dir = base_path / "parser"
        self._vector_repository = VectorRepository(collection_path=next_collection_path)
        self._chunk_store = SQLiteChunkStore(base_path / "index" / "index.sqlite3")
        self._search_service = SearchService(
            chunk_store=self._chunk_store,
            vector_repository=self._vector_repository,
        )
        self._refresh_vector_status()

    def _persist_markdown_artifact(self, node_id: str, chunks: list[dict[str, object]]) -> None:
        markdown_parts: list[str] = []
        for chunk in chunks:
            if chunk.get("status") != "ok":
                continue
            text = str(chunk.get("text") or "")
            if not text:
                continue
            markdown_parts.append(text)

        artifact_dir = self._parser_base_dir / node_id
        artifact_dir.mkdir(parents=True, exist_ok=True)
        (artifact_dir / "document.md").write_text("\n\n".join(markdown_parts), encoding="utf-8")

    def _refresh_vector_status(self) -> None:
        self._vector_status_store.update(
            chunkCount=self._vector_repository.count_chunks(),
            error="",
        )

    def _log_stage(self, msg: str, **fields: object) -> None:
        if self._logger is None:
            return
        self._logger.log("debug", msg, **fields)


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
