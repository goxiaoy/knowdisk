import os
from pathlib import Path

from worker.model.types import DEFAULT_OCR_MODEL_DISPLAY, ModelRuntimeConfig
from worker.protocol.server import create_server


def test_start_stores_model_runtime_config():
    emitted: list[dict] = []
    server = create_server(event_sink=emitted.append)

    response = server.handle_request(
        {
            "id": "req-1",
            "method": "start",
            "params": {
                "basePath": "/tmp/knowdisk",
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
                "huggingfaceEndpoint": "https://huggingface.co",
                "coreConfig": {
                    "embedding": {
                        "provider": "local",
                        "local": {"model": "Alibaba-NLP/gte-multilingual-base"},
                    },
                    "reranker": {
                        "enabled": True,
                        "provider": "local",
                        "local": {"model": "Alibaba-NLP/gte-multilingual-reranker-base"},
                    },
                    "ocr": {
                        "provider": "local",
                        "local": {
                            "model": "PaddlePaddle/PP-OCRv4_mobile",
                        },
                    },
                    "caption": {
                        "provider": "local",
                        "local": {"model": "vikhyatk/moondream2"},
                    },
                    "providers": {
                        "huggingface": {"endpoint": "https://huggingface.co"},
                    },
                },
            },
        }
    )

    assert response["result"]["ok"] is True
    assert server.model_runtime_config == ModelRuntimeConfig(
        base_path=Path("/tmp/knowdisk"),
        embedding_model="Alibaba-NLP/gte-multilingual-base",
        reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
        ocr_model=DEFAULT_OCR_MODEL_DISPLAY,
        ocr_detection_model="PaddlePaddle/PP-OCRv4_mobile_det",
        ocr_recognition_model="PaddlePaddle/PP-OCRv4_mobile_rec",
        ocr_layout_model="PaddlePaddle/PP-DocLayout_plus-L",
        ocr_region_model="PaddlePaddle/PP-DocBlockLayout",
        ocr_doc_orientation_model="PaddlePaddle/PP-LCNet_x1_0_doc_ori",
        ocr_textline_orientation_model="PaddlePaddle/PP-LCNet_x1_0_textline_ori",
        caption_model="vikhyatk/moondream2",
        preferred_device="cpu",
        model_cache_dir=Path("/tmp/knowdisk/model"),
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
                "basePath": "/tmp/knowdisk",
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

        def start_required_models(self):
            calls.append(("start_required_models", None))

    class IndexServiceStub:
        def set_storage_base_path(self, base_path):
            calls.append(("storage_base_path", base_path))

        def vector_status_snapshot(self):
            return {}

    server = create_server(
        event_sink=emitted.append,
        services={
            "model_service": ModelServiceStub(),
            "index_queue": type("IndexQueueStub", (), {"snapshot": lambda self: {}})(),
            "index_service": IndexServiceStub(),
        },
        model_fetch=lambda url, headers=None: None,
    )

    response = server.handle_request(
        {
            "id": "req-5",
            "method": "start",
            "params": {
                "basePath": "/tmp/knowdisk",
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
                "huggingfaceEndpoint": "https://huggingface.co",
                "coreConfig": {
                    "embedding": {
                        "provider": "local",
                        "local": {"model": "Alibaba-NLP/gte-multilingual-base"},
                    },
                    "reranker": {
                        "enabled": True,
                        "provider": "local",
                        "local": {"model": "Alibaba-NLP/gte-multilingual-reranker-base"},
                    },
                    "ocr": {
                        "provider": "local",
                        "local": {
                            "model": "PaddlePaddle/PP-OCRv4_mobile",
                        },
                    },
                    "caption": {
                        "provider": "local",
                        "local": {"model": "vikhyatk/moondream2"},
                    },
                    "providers": {
                        "huggingface": {"endpoint": "https://huggingface.co"},
                    },
                },
            },
        }
    )

    assert response["result"]["ok"] is True
    assert calls[0][0] == "configure"
    assert calls[1][0] == "artifact_manager"
    assert calls[2] == ("storage_base_path", Path("/tmp/knowdisk"))
    assert calls[3] == ("start_required_models", None)
    assert calls[0][1] == ModelRuntimeConfig(
        embedding_model="Alibaba-NLP/gte-multilingual-base",
        reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
        ocr_model=DEFAULT_OCR_MODEL_DISPLAY,
        ocr_detection_model="PaddlePaddle/PP-OCRv4_mobile_det",
        ocr_recognition_model="PaddlePaddle/PP-OCRv4_mobile_rec",
        ocr_layout_model="PaddlePaddle/PP-DocLayout_plus-L",
        ocr_region_model="PaddlePaddle/PP-DocBlockLayout",
        ocr_doc_orientation_model="PaddlePaddle/PP-LCNet_x1_0_doc_ori",
        ocr_textline_orientation_model="PaddlePaddle/PP-LCNet_x1_0_textline_ori",
        caption_model="vikhyatk/moondream2",
        preferred_device="cpu",
        base_path=Path("/tmp/knowdisk"),
        model_cache_dir=Path("/tmp/knowdisk/model"),
        huggingface_endpoint="https://huggingface.co",
    )
def test_start_reports_worker_ready_after_starting_model_preparation():
    emitted: list[dict] = []
    calls: list[tuple[str, object]] = []

    class ModelServiceStub:
        def configure_runtime(self, config, *, artifact_manager):
            calls.append(("configure", config))
            calls.append(("artifact_manager", artifact_manager))

        def start_required_models(self):
            calls.append(("start_required_models", None))

    class IndexServiceStub:
        def set_storage_base_path(self, base_path):
            calls.append(("storage_base_path", base_path))

        def vector_status_snapshot(self):
            return {}

    server = create_server(
        event_sink=emitted.append,
        services={
            "model_service": ModelServiceStub(),
            "index_queue": type("IndexQueueStub", (), {"snapshot": lambda self: {}})(),
            "index_service": IndexServiceStub(),
        },
        model_fetch=lambda url, headers=None: None,
    )

    response = server.handle_request(
        {
            "id": "req-6",
            "method": "start",
            "params": {
                "basePath": "/tmp/knowdisk",
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
                "huggingfaceEndpoint": "https://huggingface.co",
                "coreConfig": {
                    "embedding": {
                        "provider": "local",
                        "local": {"model": "Alibaba-NLP/gte-multilingual-base"},
                    },
                    "reranker": {
                        "enabled": True,
                        "provider": "local",
                        "local": {"model": "Alibaba-NLP/gte-multilingual-reranker-base"},
                    },
                    "ocr": {
                        "provider": "local",
                        "local": {
                            "model": "PaddlePaddle/PP-OCRv4_mobile",
                        },
                    },
                    "caption": {
                        "provider": "local",
                        "local": {"model": "vikhyatk/moondream2"},
                    },
                    "providers": {
                        "huggingface": {"endpoint": "https://huggingface.co"},
                    },
                },
            },
        }
    )

    assert response["result"]["ok"] is True
    assert calls[0][0] == "configure"
    assert calls[1][0] == "artifact_manager"
    assert calls[2] == ("storage_base_path", Path("/tmp/knowdisk"))
    assert calls[3] == ("start_required_models", None)
    assert emitted == [
        {
            "type": "worker_health_changed",
            "payload": {
                "ready": True,
            },
        }
    ]


def test_start_sets_huggingface_runtime_cache_under_base_path(monkeypatch):
    monkeypatch.delenv("HF_HOME", raising=False)
    monkeypatch.delenv("HF_MODULES_CACHE", raising=False)
    monkeypatch.delenv("TRANSFORMERS_CACHE", raising=False)
    monkeypatch.delenv("PADDLE_PDX_CACHE_HOME", raising=False)
    monkeypatch.delenv("PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK", raising=False)
    monkeypatch.delenv("PADDLE_PDX_MODEL_SOURCE", raising=False)
    monkeypatch.delenv("PADDLE_PDX_HUGGING_FACE_ENDPOINT", raising=False)

    server = create_server(event_sink=lambda event: None)

    response = server.handle_request(
        {
            "id": "req-hf-cache",
            "method": "start",
            "params": {
                "basePath": "/tmp/knowdisk",
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
            },
        }
    )

    assert response["result"]["ok"] is True
    assert os.environ["HF_HOME"] == "/tmp/knowdisk/huggingface"
    assert os.environ["HF_MODULES_CACHE"] == "/tmp/knowdisk/huggingface/modules"
    assert os.environ["TRANSFORMERS_CACHE"] == "/tmp/knowdisk/huggingface/hub"
    assert os.environ["PADDLE_PDX_CACHE_HOME"] == "/tmp/knowdisk/paddlex"
    assert os.environ["PADDLE_PDX_DISABLE_MODEL_SOURCE_CHECK"] == "True"
    assert os.environ["PADDLE_PDX_MODEL_SOURCE"] == "huggingface"
    assert os.environ["PADDLE_PDX_HUGGING_FACE_ENDPOINT"] == "https://huggingface.co"
