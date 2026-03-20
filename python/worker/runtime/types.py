from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass
from typing import Literal, Protocol, TypedDict, TypeAlias

from worker.parser.types import ParserMount, ParserNode

ModelStatusPhase: TypeAlias = Literal["idle", "verifying", "running", "completed", "failed"]
ModelTaskState: TypeAlias = Literal["verifying", "pending", "downloading", "ready", "failed"]
IndexStatusPhase: TypeAlias = Literal["idle", "indexing"]
IndexStatusScope: TypeAlias = Literal["incremental"] | None


class ModelTaskSnapshot(TypedDict, total=False):
    id: str
    model: str
    state: ModelTaskState
    progressPct: int
    error: str


class ModelTasksSnapshot(TypedDict):
    embedding: ModelTaskSnapshot | None
    reranker: ModelTaskSnapshot | None


class ModelStatusSnapshot(TypedDict):
    phase: ModelStatusPhase
    progressPct: int
    error: str
    available: bool
    tasks: ModelTasksSnapshot


class IndexStatusSnapshot(TypedDict):
    available: bool
    phase: IndexStatusPhase
    scope: IndexStatusScope
    queueDepth: int
    processedFiles: int
    totalFiles: int
    activeNodeName: str
    error: str


class VectorStatusSnapshot(TypedDict):
    available: bool
    chunkCount: int | None
    lastUpdatedAt: str
    error: str


@dataclass(frozen=True, slots=True)
class IndexNodeRequest:
    node: ParserNode
    mount: ParserMount

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> IndexNodeRequest:
        node_value = value.get("node")
        mount_value = value.get("mount")
        if not isinstance(node_value, Mapping) or not isinstance(mount_value, Mapping):
            raise ValueError("index_node request must include node and mount mappings")
        return cls(
            node=ParserNode.from_mapping(node_value),
            mount=ParserMount.from_mapping(mount_value),
        )

    def to_mapping(self) -> dict[str, object]:
        return {
            "node": {
                "nodeId": self.node.node_id,
                "mountId": self.node.mount_id,
                "name": self.node.name,
                "sourceRef": self.node.source_ref,
                "providerType": self.node.provider_type,
            },
            "mount": {
                "providerType": self.mount.provider_type,
                "syncedContentPath": self.mount.synced_content_path,
                "localFilePath": self.mount.local_file_path,
            },
        }


@dataclass(frozen=True, slots=True)
class IndexNodeResult:
    indexed: int

    def to_legacy_dict(self) -> dict[str, int]:
        return {"indexed": self.indexed}


@dataclass(frozen=True, slots=True)
class DeleteNodeRequest:
    node_id: str

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> DeleteNodeRequest:
        node_id = value.get("nodeId")
        if not isinstance(node_id, str) or not node_id:
            raise ValueError("delete_node request must include nodeId")
        return cls(node_id=node_id)

    def to_mapping(self) -> dict[str, object]:
        return {"nodeId": self.node_id}


@dataclass(frozen=True, slots=True)
class SearchRequest:
    query: str
    title_only: bool = False

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> SearchRequest:
        query = value.get("query")
        if not isinstance(query, str):
            raise ValueError("search request must include query")
        title_only = value.get("titleOnly", False)
        if not isinstance(title_only, bool):
            raise ValueError("search request titleOnly must be a boolean")
        return cls(query=query, title_only=title_only)


class SearchResultSnapshot(TypedDict, total=False):
    chunkId: str
    nodeId: str
    mountId: str
    sourceRef: str
    name: str
    title: str
    text: str
    embedding: list[float]
    score: float
    ftsScore: float
    vectorScore: float
    rerankScore: float
    matchedBy: list[str]


class SearchResponseDebugPayload(TypedDict, total=False):
    ftsResults: list[SearchResultSnapshot]
    vectorResults: list[SearchResultSnapshot]
    mergedCandidates: list[SearchResultSnapshot]
    rerankedResults: list[SearchResultSnapshot]
    finalResults: list[SearchResultSnapshot]


class SearchResponsePayload(TypedDict):
    query: str
    titleOnly: bool
    debug: SearchResponseDebugPayload


class ModelServiceProtocol(Protocol):
    def snapshot(self) -> ModelStatusSnapshot: ...

    def ensure_required_models(self) -> dict[str, bool]: ...

    def get_local_embedding_runtime(self) -> object: ...


class IndexQueueProtocol(Protocol):
    def snapshot(self) -> IndexStatusSnapshot: ...

    def enqueue_incremental(self, request: IndexNodeRequest) -> None: ...

    def enqueue_delete(self, request: DeleteNodeRequest) -> None: ...


class IndexServiceProtocol(Protocol):
    def index_node(self, request: IndexNodeRequest | Mapping[str, object]) -> IndexNodeResult: ...

    def delete_node(self, node_id: str) -> None: ...

    def search(self, query: str, title_only: bool = False) -> SearchResponsePayload: ...

    def vector_status_snapshot(self) -> VectorStatusSnapshot: ...


class WorkerServices(Protocol):
    model_service: ModelServiceProtocol
    index_queue: IndexQueueProtocol
    index_service: IndexServiceProtocol


@dataclass(frozen=True, slots=True)
class WorkerServicesBundle:
    model_service: ModelServiceProtocol
    index_queue: IndexQueueProtocol
    index_service: IndexServiceProtocol


class WorkerStatusEvent(TypedDict):
    type: str
    payload: object


def create_default_model_status_snapshot() -> ModelStatusSnapshot:
    return {
        "phase": "idle",
        "progressPct": 0,
        "error": "",
        "available": False,
        "tasks": {
            "embedding": None,
            "reranker": None,
        },
    }


def create_default_index_status_snapshot() -> IndexStatusSnapshot:
    return {
        "available": False,
        "phase": "idle",
        "scope": None,
        "queueDepth": 0,
        "processedFiles": 0,
        "totalFiles": 0,
        "activeNodeName": "",
        "error": "",
    }


def create_default_vector_status_snapshot() -> VectorStatusSnapshot:
    return {
        "available": False,
        "chunkCount": None,
        "lastUpdatedAt": "",
        "error": "",
    }


def coerce_index_node_request(value: IndexNodeRequest | Mapping[str, object]) -> IndexNodeRequest:
    if isinstance(value, IndexNodeRequest):
        return value
    return IndexNodeRequest.from_mapping(value)


def coerce_worker_services(value: WorkerServicesBundle | Mapping[str, object]) -> WorkerServicesBundle:
    if isinstance(value, WorkerServicesBundle):
        return value
    model_service = value.get("model_service")
    index_queue = value.get("index_queue")
    index_service = value.get("index_service")
    if model_service is None or index_queue is None or index_service is None:
        raise ValueError("worker services mapping must include model_service, index_queue, and index_service")
    return WorkerServicesBundle(
        model_service=model_service,  # type: ignore[arg-type]
        index_queue=index_queue,  # type: ignore[arg-type]
        index_service=index_service,  # type: ignore[arg-type]
    )


def parse_index_node_request(value: Mapping[str, object]) -> IndexNodeRequest:
    return IndexNodeRequest.from_mapping(value)


def parse_delete_node_request(value: Mapping[str, object]) -> DeleteNodeRequest:
    return DeleteNodeRequest.from_mapping(value)


def parse_search_request(value: Mapping[str, object]) -> SearchRequest:
    return SearchRequest.from_mapping(value)
