from pathlib import Path

from worker.model.types import DEFAULT_OCR_MODEL_DISPLAY, ModelRepoFile, ModelRuntimeConfig
from worker.model.model_specs import resolve_ocr_preset


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
                    "local": {
                        "model": "PaddlePaddle/PP-OCRv4_mobile",
                    },
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
    assert config.ocr_model == "PaddlePaddle/PP-OCRv4_mobile"
    assert config.ocr_detection_model == "PaddlePaddle/PP-OCRv4_mobile_det"
    assert config.ocr_recognition_model == "PaddlePaddle/PP-OCRv4_mobile_rec"
    assert config.ocr_layout_model == "PaddlePaddle/PP-DocLayout_plus-L"
    assert config.ocr_region_model == "PaddlePaddle/PP-DocBlockLayout"
    assert config.ocr_doc_orientation_model == "PaddlePaddle/PP-LCNet_x1_0_doc_ori"
    assert config.ocr_textline_orientation_model == "PaddlePaddle/PP-LCNet_x1_0_textline_ori"
    assert config.caption_model == "vikhyatk/moondream2"
    assert config.preferred_device == "cpu"
    assert config.model_cache_dir == Path("/tmp/knowdisk/model")
    assert config.huggingface_endpoint == "https://huggingface.co"


def test_ocr_preset_includes_hidden_pp_structure_defaults():
    preset = resolve_ocr_preset("PaddlePaddle/PP-OCRv4_mobile")

    assert preset["docUnwarping"] == "PaddlePaddle/UVDoc"
    assert preset["tableClassification"] == "PaddlePaddle/PP-LCNet_x1_0_table_cls"
    assert preset["wiredTableStructureRecognition"] == "PaddlePaddle/SLANeXt_wired"
    assert preset["wirelessTableStructureRecognition"] == "PaddlePaddle/SLANet_plus"
    assert preset["wiredTableCellsDetection"] == "PaddlePaddle/RT-DETR-L_wired_table_cell_det"
    assert preset["wirelessTableCellsDetection"] == "PaddlePaddle/RT-DETR-L_wireless_table_cell_det"
    assert preset["formulaRecognition"] == "PaddlePaddle/PP-FormulaNet_plus-L"


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
