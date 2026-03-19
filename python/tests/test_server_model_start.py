from pathlib import Path

from worker.model.types import ModelRuntimeConfig
from worker.protocol.server import create_server


def test_start_stores_model_runtime_config():
    emitted: list[dict] = []
    server = create_server(event_sink=emitted.append)

    response = server.handle_request(
        {
            "id": "req-1",
            "method": "start",
            "params": {
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
                "modelCacheDir": "/tmp/models",
                "huggingfaceEndpoint": "https://huggingface.co",
            },
        }
    )

    assert response["result"]["ok"] is True
    assert server.model_runtime_config == ModelRuntimeConfig(
        embedding_model="Alibaba-NLP/gte-multilingual-base",
        reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
        preferred_device="cpu",
        model_cache_dir=Path("/tmp/models"),
        huggingface_endpoint="https://huggingface.co",
    )
    assert emitted == [
        {
            "type": "worker_health_changed",
            "payload": {
                "ready": True,
            },
        }
    ]


def test_start_rejects_missing_model_config():
    emitted: list[dict] = []
    server = create_server(event_sink=emitted.append)

    response = server.handle_request(
        {
            "id": "req-2",
            "method": "start",
            "params": {
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
                "modelCacheDir": "/tmp/models",
            },
        }
    )

    assert response == {
        "id": "req-2",
        "error": {
            "code": "INVALID_PARAMS",
            "message": "missing required model runtime configuration",
        },
    }
    assert server.model_runtime_config is None
    assert emitted == []


def test_start_rejects_invalid_preferred_device():
    emitted: list[dict] = []
    server = create_server(event_sink=emitted.append)

    response = server.handle_request(
        {
            "id": "req-3",
            "method": "start",
            "params": {
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "beam",
                "modelCacheDir": "/tmp/models",
            },
        }
    )

    assert response == {
        "id": "req-3",
        "error": {
            "code": "INVALID_PARAMS",
            "message": "invalid preferred device: beam",
        },
    }
    assert server.model_runtime_config is None
    assert emitted == []


def test_start_rejects_non_object_params():
    emitted: list[dict] = []
    server = create_server(event_sink=emitted.append)

    response = server.handle_request(
        {
            "id": "req-4",
            "method": "start",
            "params": [],
        }
    )

    assert response == {
        "id": "req-4",
        "error": {
            "code": "INVALID_PARAMS",
            "message": "missing required model runtime configuration",
        },
    }
    assert server.model_runtime_config is None
    assert emitted == []


def test_start_configures_model_service_before_ensuring_models():
    emitted: list[dict] = []
    calls: list[tuple[str, object]] = []

    class ModelServiceStub:
        def configure_runtime(self, config, *, artifact_manager):
            calls.append(("configure", config))
            calls.append(("artifact_manager", artifact_manager))

        def ensure_required_models(self):
            calls.append(("ensure", None))
            return {"ok": True}

    server = create_server(
        event_sink=emitted.append,
        services={
            "model_service": ModelServiceStub(),
            "index_queue": type("IndexQueueStub", (), {"snapshot": lambda self: {}})(),
            "index_service": type("IndexServiceStub", (), {"vector_status_snapshot": lambda self: {}})(),
        },
        model_fetch=lambda url, headers=None: None,
    )

    response = server.handle_request(
        {
            "id": "req-5",
            "method": "start",
            "params": {
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
                "modelCacheDir": "/tmp/models",
                "huggingfaceEndpoint": "https://huggingface.co",
            },
        }
    )

    assert response["result"]["ok"] is True
    assert calls[0][0] == "configure"
    assert calls[1][0] == "artifact_manager"
    assert calls[2] == ("ensure", None)
    assert calls[0][1] == ModelRuntimeConfig(
        embedding_model="Alibaba-NLP/gte-multilingual-base",
        reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
        preferred_device="cpu",
        model_cache_dir=Path("/tmp/models"),
        huggingface_endpoint="https://huggingface.co",
    )
