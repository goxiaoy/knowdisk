from pathlib import Path

from worker.model.types import ModelRepoFile, ModelRuntimeConfig


def test_model_runtime_config_normalizes_mapping_inputs():
    config = ModelRuntimeConfig.from_mapping(
        {
            "basePath": "/tmp/knowdisk",
            "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
            "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
            "preferredDevice": "cpu",
            "huggingfaceEndpoint": "https://huggingface.co",
        }
    )

    assert config.base_path == Path("/tmp/knowdisk")
    assert config.embedding_model == "Alibaba-NLP/gte-multilingual-base"
    assert config.reranker_model == "Alibaba-NLP/gte-multilingual-reranker-base"
    assert config.preferred_device == "cpu"
    assert config.model_cache_dir == Path("/tmp/knowdisk/model")
    assert config.huggingface_endpoint == "https://huggingface.co"


def test_model_repo_file_round_trips_to_legacy_dict():
    repo_file = ModelRepoFile(path="config.json", size=12)

    assert repo_file.to_legacy_dict() == {
        "rfilename": "config.json",
        "size": 12,
    }
