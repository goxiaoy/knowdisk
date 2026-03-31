import sys
from pathlib import Path
from types import SimpleNamespace

from worker.model.image_runtime import (
    _prime_transformers_local_remote_code_cache,
    analyze_local_ocr_image,
    analyze_moondream_caption_image,
    load_local_caption_runtime,
    load_local_ocr_runtime,
)
from worker.model.types import LoadedCaptionRuntime, LoadedOcrRuntime, ModelRuntimeConfig


class FakeImage:
    def convert(self, mode: str):
        assert mode == "RGB"
        return self


def test_prime_transformers_local_remote_code_cache_copies_python_modules(monkeypatch, tmp_path: Path):
    model_root = tmp_path / "models" / "moondream2"
    model_root.mkdir(parents=True, exist_ok=True)
    (model_root / "hf_moondream.py").write_text("from .layers import x\n", encoding="utf-8")
    (model_root / "layers.py").write_text("x = 1\n", encoding="utf-8")
    (model_root / "config.json").write_text("{}", encoding="utf-8")
    module_cache = tmp_path / "hf-cache"

    def create_dynamic_module(name: str) -> None:
        destination = module_cache / name
        destination.mkdir(parents=True, exist_ok=True)
        init_file = destination / "__init__.py"
        if not init_file.exists():
            init_file.write_text("", encoding="utf-8")

    monkeypatch.setitem(
        sys.modules,
        "transformers.dynamic_module_utils",
        SimpleNamespace(
            _sanitize_module_name=lambda name: name,
            create_dynamic_module=create_dynamic_module,
        ),
    )
    monkeypatch.setitem(
        sys.modules,
        "transformers.utils",
        SimpleNamespace(
            HF_MODULES_CACHE=str(module_cache),
            TRANSFORMERS_DYNAMIC_MODULE_NAME="transformers_modules",
        ),
    )

    _prime_transformers_local_remote_code_cache(model_root)

    destination_root = module_cache / "transformers_modules" / "moondream2"
    assert (destination_root / "hf_moondream.py").read_text(encoding="utf-8") == "from .layers import x\n"
    assert (destination_root / "layers.py").read_text(encoding="utf-8") == "x = 1\n"


def test_load_local_ocr_runtime_loads_processor_and_model(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, object, object | None, object | None]] = []

    class FakeOcrEngine:
        pass

    class FakeLayoutEngine:
        pass

    monkeypatch.setitem(
        sys.modules,
        "paddleocr",
        SimpleNamespace(
            PaddleOCR=lambda **kwargs: calls.append(("ocr", kwargs, None, None)) or FakeOcrEngine(),
            PPStructureV3=lambda **kwargs: calls.append(("layout", kwargs, None, None)) or FakeLayoutEngine(),
        ),
    )

    runtime = load_local_ocr_runtime(
        tmp_path,
        preferred_device="cpu",
        runtime_config=ModelRuntimeConfig.from_mapping(
            {
                "basePath": str(tmp_path),
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "cpu",
                "coreConfig": {
                    "ocr": {
                        "provider": "local",
                        "local": {
                            "model": "PaddlePaddle/PP-OCRv4_mobile",
                        },
                    },
                    "caption": {"provider": "local", "local": {"model": "vikhyatk/moondream2"}},
                },
            }
        ),
    )

    assert isinstance(runtime, LoadedOcrRuntime)
    assert runtime.model_root == tmp_path
    assert runtime.ocr_engine.__class__.__name__ == "FakeOcrEngine"
    assert runtime.layout_engine.__class__.__name__ == "FakeLayoutEngine"
    assert runtime.device == "cpu"
    assert calls[0][0] == "ocr"
    assert calls[1][0] == "layout"
    assert "use_general_ocr" not in calls[1][1]
    assert calls[0][1]["use_doc_orientation_classify"] is True
    assert calls[0][1]["use_doc_unwarping"] is True
    assert calls[0][1]["use_textline_orientation"] is True
    assert calls[0][1]["text_detection_model_name"] == "PP-OCRv4_mobile_det"
    assert calls[0][1]["text_recognition_model_name"] == "PP-OCRv4_mobile_rec"
    assert calls[0][1]["doc_orientation_classify_model_name"] == "PP-LCNet_x1_0_doc_ori"
    assert calls[0][1]["doc_unwarping_model_name"] == "UVDoc"
    assert calls[0][1]["textline_orientation_model_name"] == "PP-LCNet_x1_0_textline_ori"
    assert calls[0][1]["text_detection_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-OCRv4_mobile_det")
    assert calls[0][1]["text_recognition_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-OCRv4_mobile_rec")
    assert calls[0][1]["doc_orientation_classify_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-LCNet_x1_0_doc_ori")
    assert calls[0][1]["doc_unwarping_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "UVDoc")
    assert calls[0][1]["textline_orientation_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-LCNet_x1_0_textline_ori")
    assert calls[1][1]["use_doc_orientation_classify"] is True
    assert calls[1][1]["use_doc_unwarping"] is True
    assert calls[1][1]["use_textline_orientation"] is True
    assert calls[1][1]["use_table_recognition"] is True
    assert calls[1][1]["use_formula_recognition"] is True
    assert calls[1][1]["use_region_detection"] is True
    assert calls[1][1]["use_chart_recognition"] is False
    assert calls[1][1]["use_seal_recognition"] is False
    assert calls[1][1]["layout_detection_model_name"] == "PP-DocLayout_plus-L"
    assert calls[1][1]["region_detection_model_name"] == "PP-DocBlockLayout"
    assert calls[1][1]["doc_orientation_classify_model_name"] == "PP-LCNet_x1_0_doc_ori"
    assert calls[1][1]["doc_unwarping_model_name"] == "UVDoc"
    assert calls[1][1]["textline_orientation_model_name"] == "PP-LCNet_x1_0_textline_ori"
    assert calls[1][1]["text_detection_model_name"] == "PP-OCRv4_mobile_det"
    assert calls[1][1]["text_recognition_model_name"] == "PP-OCRv4_mobile_rec"
    assert calls[1][1]["table_classification_model_name"] == "PP-LCNet_x1_0_table_cls"
    assert calls[1][1]["wired_table_structure_recognition_model_name"] == "SLANeXt_wired"
    assert calls[1][1]["wireless_table_structure_recognition_model_name"] == "SLANet_plus"
    assert calls[1][1]["wired_table_cells_detection_model_name"] == "RT-DETR-L_wired_table_cell_det"
    assert calls[1][1]["wireless_table_cells_detection_model_name"] == "RT-DETR-L_wireless_table_cell_det"
    assert calls[1][1]["table_orientation_classify_model_name"] == "PP-LCNet_x1_0_doc_ori"
    assert calls[1][1]["formula_recognition_model_name"] == "PP-FormulaNet_plus-L"
    assert calls[1][1]["layout_detection_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-DocLayout_plus-L")
    assert calls[1][1]["region_detection_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-DocBlockLayout")
    assert calls[1][1]["doc_orientation_classify_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-LCNet_x1_0_doc_ori")
    assert calls[1][1]["doc_unwarping_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "UVDoc")
    assert calls[1][1]["textline_orientation_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-LCNet_x1_0_textline_ori")
    assert calls[1][1]["text_detection_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-OCRv4_mobile_det")
    assert calls[1][1]["text_recognition_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-OCRv4_mobile_rec")
    assert calls[1][1]["table_classification_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-LCNet_x1_0_table_cls")
    assert calls[1][1]["wired_table_structure_recognition_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "SLANeXt_wired")
    assert calls[1][1]["wireless_table_structure_recognition_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "SLANet_plus")
    assert calls[1][1]["wired_table_cells_detection_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "RT-DETR-L_wired_table_cell_det")
    assert calls[1][1]["wireless_table_cells_detection_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "RT-DETR-L_wireless_table_cell_det")
    assert calls[1][1]["table_orientation_classify_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-LCNet_x1_0_doc_ori")
    assert calls[1][1]["formula_recognition_model_dir"] == str(tmp_path / "model" / "PaddlePaddle" / "PP-FormulaNet_plus-L")


def test_load_local_ocr_runtime_falls_back_to_cpu_when_mps_is_preferred(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, object, object | None, object | None]] = []

    monkeypatch.setattr("worker.model.image_runtime.torch.cuda.is_available", lambda: False)
    monkeypatch.setitem(
        sys.modules,
        "paddleocr",
        SimpleNamespace(
            PaddleOCR=lambda **kwargs: calls.append(("ocr", kwargs.get("device"), None, None)) or object(),
            PPStructureV3=lambda **kwargs: calls.append(("layout", kwargs.get("device"), None, None)) or object(),
        ),
    )

    runtime = load_local_ocr_runtime(
        tmp_path,
        preferred_device="mps",
        runtime_config=ModelRuntimeConfig.from_mapping(
            {
                "basePath": str(tmp_path),
                "embeddingModel": "Alibaba-NLP/gte-multilingual-base",
                "rerankerModel": "Alibaba-NLP/gte-multilingual-reranker-base",
                "preferredDevice": "mps",
                "coreConfig": {
                    "ocr": {
                        "provider": "local",
                        "local": {
                            "model": "PaddlePaddle/PP-OCRv4_mobile",
                        },
                    },
                    "caption": {"provider": "local", "local": {"model": "vikhyatk/moondream2"}},
                },
            }
        ),
    )

    assert runtime.device == "cpu"
    assert calls == [("ocr", "cpu", None, None), ("layout", "cpu", None, None)]


def test_load_local_caption_runtime_loads_moondream_model(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, object, object]] = []

    class FakeModel:
        def eval(self):
            calls.append(("eval", None, None))
            return self

        def to(self, device):
            calls.append(("to", device, None))
            return self

    monkeypatch.setattr(
        "worker.model.image_runtime.AutoModelForCausalLM.from_pretrained",
        lambda model_path, trust_remote_code, dtype: calls.append(("model", model_path, dtype)) or FakeModel(),
    )

    runtime = load_local_caption_runtime(tmp_path, preferred_device="cpu")

    assert isinstance(runtime, LoadedCaptionRuntime)
    assert runtime.model_root == tmp_path
    assert runtime.model.__class__.__name__ == "FakeModel"
    assert runtime.device == "cpu"
    assert calls[0][0] == "model"


def test_analyze_local_ocr_image_collects_text_and_regions(monkeypatch, tmp_path: Path):
    source_path = tmp_path / "image.png"
    source_path.write_bytes(b"png")
    monkeypatch.setattr("worker.model.image_runtime.Image.open", lambda path: FakeImage())

    class FakeOcrEngine:
        def predict(self, input_path):
            assert input_path == str(source_path)
            return [
                {
                    "res": {
                        "rec_texts": ["门诊", "收费票据"],
                        "rec_boxes": [[1, 2, 3, 4], [5, 6, 7, 8]],
                    }
                }
            ]

    class FakeLayoutEngine:
        def predict(self, input_path):
            assert input_path == str(source_path)
            return [
                {
                    "res": {
                        "layout": [
                            {"label": "title", "bbox": [0, 0, 100, 40], "text": "门诊"},
                            {"label": "text", "bbox": [0, 50, 300, 140], "text": "收费票据"},
                        ]
                    }
                }
            ]

    runtime = LoadedOcrRuntime(
        model_root=tmp_path,
        preferred_device="cpu",
        ocr_engine=FakeOcrEngine(),
        layout_engine=FakeLayoutEngine(),
        device="cpu",
    )

    result = analyze_local_ocr_image(runtime, str(source_path))

    assert result["text"] == "门诊\n收费票据"
    assert result["page"] == ""
    assert result["regions"] == [
        {"id": "layout-0", "bbox": [0, 0, 100, 40], "text": "门诊"},
        {"id": "layout-1", "bbox": [0, 50, 300, 140], "text": "收费票据"},
    ]
    assert result["debug"] == {
        "ocrPayloadKeys": ["rec_boxes", "rec_texts"],
        "layoutPayloadKeys": ["layout"],
        "ocrPreviewTexts": ["门诊", "收费票据"],
        "layoutPreviewTexts": ["门诊", "收费票据"],
    }


def test_analyze_local_ocr_image_falls_back_to_ocr_boxes_when_layout_is_missing(monkeypatch, tmp_path: Path):
    source_path = tmp_path / "image.png"
    source_path.write_bytes(b"png")
    monkeypatch.setattr("worker.model.image_runtime.Image.open", lambda path: FakeImage())

    class FakeOcrEngine:
        def predict(self, input_path):
            assert input_path == str(source_path)
            return [
                {
                    "res": {
                        "rec_texts": ["住院", "结算单"],
                        "rec_boxes": [[10, 20, 30, 40], [40, 50, 80, 90]],
                    }
                }
            ]

    class FakeLayoutEngine:
        def predict(self, input_path):
            assert input_path == str(source_path)
            return []

    runtime = LoadedOcrRuntime(
        model_root=tmp_path,
        preferred_device="cpu",
        ocr_engine=FakeOcrEngine(),
        layout_engine=FakeLayoutEngine(),
        device="cpu",
    )

    result = analyze_local_ocr_image(runtime, str(source_path))

    assert result["text"] == "住院\n结算单"
    assert result["regions"] == [
        {"id": "ocr-0", "bbox": [10, 20, 30, 40], "text": "住院"},
        {"id": "ocr-1", "bbox": [40, 50, 80, 90], "text": "结算单"},
    ]


def test_analyze_local_ocr_image_reads_ppstructure_parsing_result_blocks(monkeypatch, tmp_path: Path):
    source_path = tmp_path / "image.png"
    source_path.write_bytes(b"png")
    monkeypatch.setattr("worker.model.image_runtime.Image.open", lambda path: FakeImage())

    class FakeOcrEngine:
        def predict(self, input_path):
            assert input_path == str(source_path)
            return [{"res": {"rec_texts": ["税", "销售方信息"], "rec_boxes": [[1, 2, 3, 4], [5, 6, 7, 8]]}}]

    class FakeLayoutEngine:
        def predict(self, input_path):
            assert input_path == str(source_path)
            return [
                {
                    "res": {
                        "parsing_res_list": [
                            {"block_label": "title", "block_bbox": [0, 0, 100, 40], "block_text": "电子发票"},
                            {"block_label": "text", "block_bbox": [0, 50, 300, 140], "block_content": "销售方信息"},
                        ]
                    }
                }
            ]

    runtime = LoadedOcrRuntime(
        model_root=tmp_path,
        preferred_device="cpu",
        ocr_engine=FakeOcrEngine(),
        layout_engine=FakeLayoutEngine(),
        device="cpu",
    )

    result = analyze_local_ocr_image(runtime, str(source_path))

    assert result["regions"] == [
        {"id": "layout-0", "bbox": [0, 0, 100, 40], "text": "电子发票"},
        {"id": "layout-1", "bbox": [0, 50, 300, 140], "text": "销售方信息"},
    ]
    assert result["debug"]["layoutPreviewTexts"] == ["电子发票", "销售方信息"]


def test_analyze_moondream_caption_image_calls_caption(monkeypatch, tmp_path: Path):
    source_path = tmp_path / "image.png"
    source_path.write_bytes(b"png")
    calls: list[tuple[str, object]] = []

    class FakeModel:
        def caption(self, image, length="short"):
            calls.append(("caption", length))
            return {"caption": "A scoreboard screenshot"}

    monkeypatch.setattr("worker.model.image_runtime.Image.open", lambda path: FakeImage())

    runtime = LoadedCaptionRuntime(
        model_root=tmp_path,
        preferred_device="cpu",
        model=FakeModel(),
        device="cpu",
    )

    result = analyze_moondream_caption_image(runtime, str(source_path))

    assert result == {"caption": "A scoreboard screenshot"}
    assert calls == [("caption", "short")]
