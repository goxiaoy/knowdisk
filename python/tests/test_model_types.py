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
            "coreConfig": {
                "ocr": {
                    "provider": "local",
                    "local": {"model": "PaddlePaddle/PaddleOCR-VL"},
                },
                "caption": {
                    "provider": "local",
                    "local": {"model": "vikhyatk/moondream2"},
                },
            },
        }
    )

    assert config.base_path == Path("/tmp/knowdisk")
    assert config.embedding_model == "Alibaba-NLP/gte-multilingual-base"
    assert config.reranker_model == "Alibaba-NLP/gte-multilingual-reranker-base"
    assert config.ocr_model == "PaddlePaddle/PaddleOCR-VL"
    assert config.caption_model == "vikhyatk/moondream2"
    assert config.preferred_device == "cpu"
    assert config.model_cache_dir == Path("/tmp/knowdisk/model")
    assert config.huggingface_endpoint == "https://huggingface.co"


def test_model_repo_file_round_trips_to_legacy_dict():
    repo_file = ModelRepoFile(path="config.json", size=12)

    assert repo_file.to_legacy_dict() == {
        "rfilename": "config.json",
        "size": 12,
    }


def test_model_repo_file_uses_lfs_size_when_top_level_size_is_missing():
    repo_file = ModelRepoFile.from_mapping(
        {
            "rfilename": "model.safetensors",
            "lfs": {
                "size": 123,
            },
        }
    )

    assert repo_file.path == "model.safetensors"
    assert repo_file.size == 123
