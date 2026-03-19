from worker.parser.types import ParserMount, ParserNode
from worker.runtime.types import IndexNodeRequest
from worker.index_service import IndexService
from worker.status import VectorStatusStore
from worker.vector_repository import VectorRepository


class FakeEmbeddingRuntime:
    def __call__(self, text: str):
        return [float(len(text))]


def test_index_node_parses_embeds_and_updates_vector_count(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "hello world",
                "title": "hello",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": "/tmp/hello.md",
                },
            }
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {"get_local_embedding_runtime": lambda self: FakeEmbeddingRuntime()},
        )(),
        vector_repository=repository,
        vector_status_store=vector_store,
    )

    result = service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-1",
                name="hello.md",
                source_ref="hello.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                directory="/tmp",
                content_dir="",
                provider_type="local",
            ),
        )
    )

    assert result.indexed == 1
    assert repository.count_chunks() == 1
    assert service.vector_status_snapshot()["chunkCount"] == 1


def test_delete_node_removes_vectors_and_updates_count(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "hello world",
                "title": "hello",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": "/tmp/hello.md",
                },
            }
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {"get_local_embedding_runtime": lambda self: FakeEmbeddingRuntime()},
        )(),
        vector_repository=repository,
        vector_status_store=vector_store,
    )

    service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-1",
                name="hello.md",
                source_ref="hello.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                directory="/tmp",
                content_dir="",
                provider_type="local",
            ),
        )
    )
    service.delete_node("node-1")

    assert repository.count_chunks() == 0
    assert service.vector_status_snapshot()["chunkCount"] == 0


def test_search_returns_repository_rows(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "hello world",
                "title": "hello",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": "/tmp/hello.md",
                },
            }
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {"get_local_embedding_runtime": lambda self: FakeEmbeddingRuntime()},
        )(),
        vector_repository=repository,
        vector_status_store=vector_store,
    )

    service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-1",
                name="hello.md",
                source_ref="hello.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                directory="/tmp",
                content_dir="",
                provider_type="local",
            ),
        )
    )

    results = service.search("hello")

    assert results[0]["nodeId"] == "node-1"
    assert results[0]["text"] == "hello world"
