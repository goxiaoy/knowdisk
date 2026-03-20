import sqlite3

from worker.index.chunk_store import SQLiteChunkStore
from worker.parser.types import ParserMount, ParserNode
from worker.runtime.types import IndexNodeRequest
from worker.index.service import IndexService
from worker.runtime.status import VectorStatusStore
from worker.vector.repository import VectorRepository


class FakeEmbeddingRuntime:
    def __call__(self, text: str):
        return [float(len(text))]


class KeywordEmbeddingRuntime:
    def __call__(self, text: str):
        normalized = text.lower()
        if "alpha" in normalized:
            return [1.0, 0.0]
        if "beta" in normalized:
            return [0.0, 1.0]
        return [0.0, 0.0]


class KeywordRerankerRuntime:
    def __call__(self, query: str, candidate: dict[str, object]) -> float:
        text = str(candidate.get("text") or "")
        title = str(candidate.get("title") or "")
        haystack = f"{title}\n{text}".lower()
        return 10.0 if query.lower() in haystack else 0.0


def test_index_node_parses_embeds_and_updates_vector_count(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(tmp_path / "chunks.sqlite3")
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
            {
                "get_local_embedding_runtime": lambda self: FakeEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: KeywordRerankerRuntime(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
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
                synced_content_path="",
                local_file_path="/tmp/hello.md",
                provider_type="local",
            ),
        )
    )

    assert result.indexed == 1
    assert repository.count_chunks() == 1
    assert service.vector_status_snapshot()["chunkCount"] == 1
    assert chunk_store.count_chunks() == 1
    assert [row.chunk_id for row in chunk_store.search_fts("hello")] == ["node-1:0"]


def test_delete_node_removes_vectors_and_updates_count(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(tmp_path / "chunks.sqlite3")
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
            {
                "get_local_embedding_runtime": lambda self: FakeEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: KeywordRerankerRuntime(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
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
                synced_content_path="",
                local_file_path="/tmp/hello.md",
                provider_type="local",
            ),
        )
    )
    service.delete_node("node-1")

    assert repository.count_chunks() == 0
    assert service.vector_status_snapshot()["chunkCount"] == 0
    assert chunk_store.count_chunks() == 0


def test_search_returns_repository_rows(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(tmp_path / "chunks.sqlite3")
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
            {
                "get_local_embedding_runtime": lambda self: FakeEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: KeywordRerankerRuntime(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
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
                synced_content_path="",
                local_file_path="/tmp/hello.md",
                provider_type="local",
            ),
        )
    )

    results = service.search("hello")

    assert results["query"] == "hello"
    assert results["debug"]["vectorResults"][0]["nodeId"] == "node-1"
    assert results["debug"]["finalResults"][0]["text"] == "hello world"


def test_search_uses_query_embedding_for_vector_lookup(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(tmp_path / "chunks.sqlite3")
    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "alpha topic",
                "title": "alpha",
                "source": {
                    "nodeId": "node-a",
                    "name": "a.md",
                    "path": "/tmp/a.md",
                },
            },
            {
                "status": "ok",
                "chunkIndex": 1,
                "text": "beta topic",
                "title": "beta",
                "source": {
                    "nodeId": "node-b",
                    "name": "b.md",
                    "path": "/tmp/b.md",
                },
            },
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {
                "get_local_embedding_runtime": lambda self: KeywordEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: KeywordRerankerRuntime(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
    )

    service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-1",
                name="mixed.md",
                source_ref="mixed.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                synced_content_path="",
                local_file_path="/tmp/mixed.md",
                provider_type="local",
            ),
        )
    )

    results = service.search("beta only")

    assert results["debug"]["vectorResults"][0]["text"] == "beta topic"
    assert results["debug"]["finalResults"][0]["text"] == "beta topic"


def test_index_node_persists_chunk_rows_into_sqlite_fts(tmp_path):
    db_path = tmp_path / "chunks.sqlite3"
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(db_path)
    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "fts body text",
                "title": "fts title",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": "/tmp/fts.md",
                },
            }
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {
                "get_local_embedding_runtime": lambda self: FakeEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: KeywordRerankerRuntime(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
    )

    service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-fts",
                name="fts.md",
                source_ref="fts.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                synced_content_path="",
                local_file_path="/tmp/fts.md",
                provider_type="local",
            ),
        )
    )

    with sqlite3.connect(db_path) as connection:
        row = connection.execute(
            "SELECT chunk_id, node_id, title, text FROM index_chunks WHERE node_id = ?",
            ("node-fts",),
        ).fetchone()
    assert row == ("node-fts:0", "node-fts", "fts title", "fts body text")
    assert [row.chunk_id for row in chunk_store.search_fts("title")] == ["node-fts:0"]


def test_search_merges_fts_and_vector_candidates_into_debug_payload(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(tmp_path / "chunks.sqlite3")
    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "alpha body text",
                "title": "alpha title",
                "source": {
                    "nodeId": "node-a",
                    "name": "a.md",
                    "path": "/tmp/a.md",
                },
            },
            {
                "status": "ok",
                "chunkIndex": 1,
                "text": "beta body text",
                "title": "beta title",
                "source": {
                    "nodeId": "node-b",
                    "name": "b.md",
                    "path": "/tmp/b.md",
                },
            },
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {
                "get_local_embedding_runtime": lambda self: KeywordEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: KeywordRerankerRuntime(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
    )

    service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-search",
                name="search.md",
                source_ref="search.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                synced_content_path="",
                local_file_path="/tmp/search.md",
                provider_type="local",
            ),
        )
    )

    results = service.search("alpha")

    assert [row["nodeId"] for row in results["debug"]["ftsResults"]] == ["node-search"]
    assert any(row["text"] == "alpha body text" for row in results["debug"]["vectorResults"])
    assert any(row["text"] == "alpha body text" for row in results["debug"]["mergedCandidates"])
    assert any(row["text"] == "alpha body text" for row in results["debug"]["finalResults"])


def test_search_title_only_restricts_fts_matches_to_titles(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(tmp_path / "chunks.sqlite3")
    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "query appears only in body",
                "title": "unrelated title",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": "/tmp/title.md",
                },
            },
            {
                "status": "ok",
                "chunkIndex": 1,
                "text": "body does not matter",
                "title": "query in title",
                "source": {
                    "nodeId": node.node_id,
                    "name": node.name,
                    "path": "/tmp/title.md",
                },
            },
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {
                "get_local_embedding_runtime": lambda self: KeywordEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: KeywordRerankerRuntime(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
    )

    service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-title",
                name="title.md",
                source_ref="title.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                synced_content_path="",
                local_file_path="/tmp/title.md",
                provider_type="local",
            ),
        )
    )

    results = service.search("query", title_only=True)

    assert [row["title"] for row in results["debug"]["ftsResults"]] == ["query in title"]


def test_search_reranker_reorders_final_results(tmp_path):
    vector_store = VectorStatusStore(event_sink=lambda event: None)
    repository = VectorRepository(collection_path=str(tmp_path / "index.zvec"))
    chunk_store = SQLiteChunkStore(tmp_path / "chunks.sqlite3")

    class NeutralEmbeddingRuntime:
        def __call__(self, text: str):
            _ = text
            return [0.0]

    class PreferSecondReranker:
        def __call__(self, query: str, candidate: dict[str, object]) -> float:
            _ = query
            return 100.0 if candidate.get("title") == "second" else 1.0

    service = IndexService(
        parse_node=lambda node, mount: [
            {
                "status": "ok",
                "chunkIndex": 0,
                "text": "first text",
                "title": "first",
                "source": {"nodeId": node.node_id, "name": node.name, "path": "/tmp/rank.md"},
            },
            {
                "status": "ok",
                "chunkIndex": 1,
                "text": "second text",
                "title": "second",
                "source": {"nodeId": node.node_id, "name": node.name, "path": "/tmp/rank.md"},
            },
        ],
        model_service=type(
            "ModelServiceStub",
            (),
            {
                "get_local_embedding_runtime": lambda self: NeutralEmbeddingRuntime(),
                "get_local_reranker_runtime": lambda self: PreferSecondReranker(),
            },
        )(),
        vector_repository=repository,
        chunk_store=chunk_store,
        vector_status_store=vector_store,
        parser_base_dir=tmp_path / "parser",
    )

    service.index_node(
        IndexNodeRequest(
            node=ParserNode(
                node_id="node-rerank",
                name="rank.md",
                source_ref="rank.md",
                provider_type="local",
                mount_id="m1",
            ),
            mount=ParserMount(
                synced_content_path="",
                local_file_path="/tmp/rank.md",
                provider_type="local",
            ),
        )
    )

    results = service.search("rank")

    assert results["debug"]["mergedCandidates"][0]["title"] == "first"
    assert results["debug"]["finalResults"][0]["title"] == "second"
