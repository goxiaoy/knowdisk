import sqlite3
from pathlib import Path

from worker.index.service import IndexService
from worker.model.service import ModelService
from worker.model.types import ModelRuntimeConfig
from worker.parser.service import parse_node as parse_node_from_mount
from worker.parser.types import ParserMount, ParserNode
from worker.runtime.status import ModelStatusStore, VectorStatusStore
from worker.runtime.types import IndexNodeRequest
from worker.vector.repository import VectorRepository


def test_indexes_dataset_files_into_markdown_artifacts_and_zvec(tmp_path: Path):
    data_dir = Path(__file__).parent / "data"
    parser_dir = tmp_path / "parser"
    repository = VectorRepository(collection_path=str(tmp_path / "index" / "index.zvec"))
    index_service = IndexService(
        parse_node=create_dataset_parser(),
        model_service=create_model_service(),
        vector_repository=repository,
        vector_status_store=VectorStatusStore(event_sink=lambda event: None),
        parser_base_dir=parser_dir,
    )

    files = [
        ("node-md", "hello.md", "github markup"),
        ("node-json", "info.json", "parser example"),
        ("node-pdf", "paper.pdf", "paper extracted"),
        ("node-image", "image.png", "image described"),
    ]

    for node_id, file_name, _query in files:
        index_service.index_node(
            IndexNodeRequest(
                node=ParserNode(
                    node_id=node_id,
                    mount_id="mount-1",
                    name=file_name,
                    source_ref=file_name,
                    provider_type="local",
                ),
                mount=ParserMount(
                    synced_content_path="",
                    local_file_path=str(data_dir / file_name),
                    provider_type="local",
                ),
            )
        )

    assert repository.count_chunks() == 9
    assert index_service.vector_status_snapshot()["chunkCount"] == 9
    assert (parser_dir / "node-md" / "document.md").read_text(encoding="utf-8").startswith(
        "# GitHub Markup"
    )
    assert '"name": "parser-example"' in (parser_dir / "node-json" / "document.md").read_text(
        encoding="utf-8"
    )
    assert "Paper extracted markdown" in (
        parser_dir / "node-pdf" / "document.md"
    ).read_text(encoding="utf-8")
    assert "Image described markdown" in (
        parser_dir / "node-image" / "document.md"
    ).read_text(encoding="utf-8")
    with sqlite3.connect(tmp_path / "index" / "index.sqlite3") as connection:
        count = connection.execute("SELECT COUNT(*) FROM index_chunks").fetchone()[0]
    assert count == 9

    markdown_search = index_service.search("github markup")
    assert markdown_search["debug"]["ftsResults"]
    assert markdown_search["debug"]["vectorResults"]
    assert markdown_search["debug"]["rerankedResults"]
    assert any(
        result["nodeId"] == "node-md"
        for result in markdown_search["debug"]["finalResults"]
    )
    assert isinstance(markdown_search["debug"]["finalResults"][0]["rerankScore"], float)

    json_search = index_service.search("parser example")
    assert any(result["nodeId"] == "node-json" for result in json_search["debug"]["finalResults"])
    pdf_search = index_service.search("paper extracted")
    assert any(result["nodeId"] == "node-pdf" for result in pdf_search["debug"]["finalResults"])
    image_search = index_service.search("image described")
    assert any(result["nodeId"] == "node-image" for result in image_search["debug"]["finalResults"])


def create_dataset_parser():
    def parse_dataset_node(node, mount):
        if node.name == "paper.pdf":
            return [
                {
                    "status": "ok",
                    "chunkIndex": 0,
                    "text": "Paper extracted markdown",
                    "title": "Paper",
                    "source": {
                        "nodeId": node.node_id,
                        "name": node.name,
                        "path": mount.local_file_path,
                    },
                }
            ]
        if node.name == "image.png":
            return [
                {
                    "status": "ok",
                    "chunkIndex": 0,
                    "text": "Image described markdown",
                    "title": "Image",
                    "source": {
                        "nodeId": node.node_id,
                        "name": node.name,
                        "path": mount.local_file_path,
                    },
                }
            ]
        return parse_node_from_mount(node, mount)

    return parse_dataset_node


def create_model_service() -> ModelService:
    def rerank(query: str, candidate: dict[str, object]) -> float:
        haystack = f'{candidate.get("title", "")}\n{candidate.get("text", "")}'.lower()
        return 100.0 if query.lower() in haystack else 0.0

    class FakeArtifactManager:
        def resolve_model_root(self, kind: str, model: str) -> Path:
            return Path("/tmp") / kind / model.replace("/", "-")

        def ensure_artifacts(self, kind: str, model: str, force_redownload: bool = False, on_progress=None):
            _ = (kind, model, force_redownload, on_progress)
            return type("FakeArtifactResult", (), {"model_root": Path("/tmp"), "files": [], "downloaded_files": 0, "downloaded_bytes": 0})()

    service = ModelService(
        status_store=ModelStatusStore(event_sink=lambda event: None),
        runtime_config=ModelRuntimeConfig(
            base_path=Path("/tmp"),
            embedding_model="Alibaba-NLP/gte-multilingual-base",
            reranker_model="Alibaba-NLP/gte-multilingual-reranker-base",
            ocr_model="PaddlePaddle/PaddleOCR-VL",
            caption_model="vikhyatk/moondream2",
            preferred_device="cpu",
            model_cache_dir=Path("/tmp/model"),
            huggingface_endpoint="https://hf.example",
        ),
        artifact_manager=FakeArtifactManager(),
        embedding_runtime_loader=lambda model_path, *, preferred_device: lambda text: [float(len(text))],
        reranker_runtime_loader=lambda model_path, *, preferred_device: rerank,
    )
    assert service.ensure_required_models() == {"ok": True}
    return service
