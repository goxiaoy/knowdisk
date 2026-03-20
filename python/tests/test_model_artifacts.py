from pathlib import Path

from worker.model.artifacts import (
    has_resumable_partial_downloads,
    has_complete_local_model_artifacts,
    select_embedding_repo_files,
    select_reranker_repo_files,
)


def test_select_embedding_repo_files_keeps_sentence_transformer_assets():
    selected = select_embedding_repo_files(
        [
            {"rfilename": "README.md", "size": 1},
            {"rfilename": "config.json", "size": 2},
            {"rfilename": "config_sentence_transformers.json", "size": 3},
            {"rfilename": "modules.json", "size": 3},
            {"rfilename": "tokenizer.json", "size": 4},
            {"rfilename": "tokenizer_config.json", "size": 5},
            {"rfilename": "special_tokens_map.json", "size": 6},
            {"rfilename": "sentence_bert_config.json", "size": 7},
            {"rfilename": "1_Pooling/config.json", "size": 8},
            {"rfilename": "model.safetensors", "size": 8},
            {"rfilename": "onnx/model.onnx", "size": 9},
        ]
    )

    assert [item.path for item in selected] == [
        "config.json",
        "config_sentence_transformers.json",
        "modules.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "sentence_bert_config.json",
        "1_Pooling/config.json",
        "model.safetensors",
    ]


def test_select_reranker_repo_files_keeps_transformer_assets():
    selected = select_reranker_repo_files(
        [
            {"rfilename": "notes.txt", "size": 1},
            {"rfilename": "config.json", "size": 2},
            {"rfilename": "tokenizer.json", "size": 3},
            {"rfilename": "tokenizer_config.json", "size": 4},
            {"rfilename": "special_tokens_map.json", "size": 5},
            {"rfilename": "pytorch_model.bin", "size": 6},
            {"rfilename": "model.safetensors", "size": 7},
            {"rfilename": "onnx/model.onnx", "size": 8},
        ]
    )

    assert [item.path for item in selected] == [
        "config.json",
        "tokenizer.json",
        "tokenizer_config.json",
        "special_tokens_map.json",
        "pytorch_model.bin",
        "model.safetensors",
    ]


def test_selectors_ignore_unrelated_files_and_nested_onnx_assets():
    selected_embedding = select_embedding_repo_files(
        [
            {"rfilename": "docs/README.md", "size": 1},
            {"rfilename": "docs/config.json", "size": 2},
            {"rfilename": "onnx/model.onnx", "size": 2},
            {"rfilename": "onnx/model.onnx_data", "size": 3},
        ]
    )
    selected_reranker = select_reranker_repo_files(
        [
            {"rfilename": "docs/README.md", "size": 1},
            {"rfilename": "onnx/model.onnx", "size": 2},
            {"rfilename": "onnx/model.onnx_data", "size": 3},
        ]
    )

    assert selected_embedding == []
    assert selected_reranker == []


def test_embedding_local_artifacts_require_sentence_transformers_metadata_and_no_part_files(
    tmp_path: Path,
):
    model_root = tmp_path / "embedding"
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / "config.json").write_text("{}", encoding="utf-8")
    (model_root / "modules.json").write_text("[]", encoding="utf-8")
    (model_root / "1_Pooling").mkdir(parents=True, exist_ok=True)
    (model_root / "1_Pooling" / "config.json").write_text("{}", encoding="utf-8")
    (model_root / "model.safetensors.part").write_bytes(b"partial")

    assert has_complete_local_model_artifacts("embedding", model_root) is False

    (model_root / "model.safetensors.part").unlink()
    (model_root / "model.safetensors").write_bytes(b"weights")

    assert has_complete_local_model_artifacts("embedding", model_root) is True


def test_reranker_local_artifacts_require_config_and_weights(tmp_path: Path):
    model_root = tmp_path / "reranker"
    model_root.mkdir(parents=True, exist_ok=True)

    assert has_complete_local_model_artifacts("reranker", model_root) is False

    (model_root / "config.json").write_text("{}", encoding="utf-8")
    (model_root / "pytorch_model.bin").write_bytes(b"weights")

    assert has_complete_local_model_artifacts("reranker", model_root) is True


def test_detects_resumable_partial_downloads(tmp_path: Path):
    model_root = tmp_path / "embedding"
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / "config.json.part").write_bytes(b"partial")

    assert has_resumable_partial_downloads(model_root) is True

    (model_root / "config.json.part").unlink()
    (model_root / "config.json").write_text("{}", encoding="utf-8")

    assert has_resumable_partial_downloads(model_root) is False
