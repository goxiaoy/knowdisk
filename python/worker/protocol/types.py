from __future__ import annotations

from typing import Literal, NotRequired, TypedDict, TypeAlias

PythonWorkerPreferredDevice: TypeAlias = Literal["cpu", "mps", "cuda"]


class PythonWorkerStartParams(TypedDict):
    basePath: str
    embeddingModel: str
    rerankerModel: str
    preferredDevice: PythonWorkerPreferredDevice
    huggingfaceEndpoint: NotRequired[str]
    coreConfig: NotRequired[object]


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
