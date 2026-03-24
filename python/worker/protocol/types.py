from __future__ import annotations

from typing import Literal, NotRequired, TypedDict, TypeAlias

PythonWorkerPreferredDevice: TypeAlias = Literal["cpu", "mps", "cuda"]


class PythonWorkerLocalModelConfig(TypedDict):
    model: str


class PythonWorkerEmbeddingLocalModelConfig(PythonWorkerLocalModelConfig):
    dimension: int


class PythonWorkerRerankerLocalModelConfig(PythonWorkerLocalModelConfig):
    topN: int


class PythonWorkerEmbeddingConfig(TypedDict):
    provider: Literal["local", "openai", "qwen"]
    local: NotRequired[PythonWorkerEmbeddingLocalModelConfig]


class PythonWorkerRerankerConfig(TypedDict):
    enabled: bool
    provider: Literal["local", "openai", "qwen"]
    local: NotRequired[PythonWorkerRerankerLocalModelConfig]


class PythonWorkerImageModelConfig(TypedDict):
    provider: Literal["local"]
    local: NotRequired[PythonWorkerLocalModelConfig]


class PythonWorkerCoreConfig(TypedDict):
    embedding: PythonWorkerEmbeddingConfig
    reranker: PythonWorkerRerankerConfig
    ocr: PythonWorkerImageModelConfig
    caption: PythonWorkerImageModelConfig
    providers: dict[str, object]


class PythonWorkerStartParams(TypedDict):
    basePath: str
    embeddingModel: str
    rerankerModel: str
    preferredDevice: PythonWorkerPreferredDevice
    huggingfaceEndpoint: NotRequired[str]
    coreConfig: NotRequired[PythonWorkerCoreConfig]


class PythonWorkerRequestFrame(TypedDict):
    id: str
    method: str
    params: object


class PythonWorkerStartRequestFrame(TypedDict):
    id: str
    method: Literal["start"]
    params: PythonWorkerStartParams


class PythonWorkerError(TypedDict):
    code: str
    message: str
    data: NotRequired[object]


class PythonWorkerResponseFrame(TypedDict, total=False):
    id: str
    result: object
    error: PythonWorkerError


class PythonWorkerEventFrame(TypedDict):
    type: str
    payload: object


PythonWorkerFrame: TypeAlias = (
    PythonWorkerRequestFrame | PythonWorkerResponseFrame | PythonWorkerEventFrame
)

PythonWorkerStartRequest: TypeAlias = PythonWorkerStartRequestFrame
