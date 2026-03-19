from worker.model_artifacts import select_embedding_repo_files, select_reranker_repo_files


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

    assert [item["path"] for item in selected] == [
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

    assert [item["path"] for item in selected] == [
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
