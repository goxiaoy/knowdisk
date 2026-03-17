from worker.model_service import ModelService
from worker.status import ModelStatusStore


def test_default_model_status_is_idle():
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    service = ModelService(
        status_store=store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: object(),
        load_reranker_runtime=lambda: object(),
    )

    assert service.snapshot()["phase"] == "idle"


def test_ensure_models_marks_tasks_ready():
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)
    service = ModelService(
        status_store=store,
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: object(),
        load_reranker_runtime=lambda: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": True}
    assert service.snapshot()["phase"] == "completed"
    assert service.snapshot()["tasks"]["embedding"]["state"] == "ready"
    assert service.snapshot()["tasks"]["reranker"]["state"] == "ready"


def test_download_failure_updates_model_status():
    emitted: list[dict] = []
    store = ModelStatusStore(event_sink=emitted.append)

    def fail() -> None:
        raise RuntimeError("download failed")

    service = ModelService(
        status_store=store,
        verify_embedding=fail,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: object(),
        load_reranker_runtime=lambda: object(),
    )

    result = service.ensure_required_models()

    assert result == {"ok": False}
    assert service.snapshot()["phase"] == "failed"
    assert service.snapshot()["error"] == "download failed"


def test_runtime_accessors_return_loaded_runtimes():
    embedding_runtime = object()
    reranker_runtime = object()
    service = ModelService(
        status_store=ModelStatusStore(event_sink=lambda event: None),
        verify_embedding=lambda: None,
        verify_reranker=lambda: None,
        load_embedding_runtime=lambda: embedding_runtime,
        load_reranker_runtime=lambda: reranker_runtime,
    )

    assert service.get_local_embedding_runtime() is embedding_runtime
    assert service.get_local_reranker_runtime() is reranker_runtime
