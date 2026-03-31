from __future__ import annotations

import importlib
import shutil
from collections.abc import Iterable, Mapping
from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModelForCausalLM

from worker.model.model_specs import resolve_ocr_preset
from worker.model.types import LoadedCaptionRuntime, LoadedOcrRuntime, ModelRuntimeConfig


def load_local_ocr_runtime(
    model_path: Path,
    *,
    preferred_device: str,
    runtime_config: ModelRuntimeConfig,
) -> LoadedOcrRuntime:
    device = _resolve_ocr_device(preferred_device)
    paddleocr = _import_paddleocr()
    preset = resolve_ocr_preset(runtime_config.ocr_model)
    detection_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["detection"])
    recognition_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["recognition"])
    layout_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["layout"])
    region_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["region"])
    doc_orientation_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["docOrientation"])
    textline_orientation_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["textlineOrientation"])
    doc_unwarping_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["docUnwarping"])
    table_classification_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["tableClassification"])
    wired_table_structure_root = _resolve_cached_model_root(
        runtime_config.model_cache_dir, preset["wiredTableStructureRecognition"]
    )
    wireless_table_structure_root = _resolve_cached_model_root(
        runtime_config.model_cache_dir, preset["wirelessTableStructureRecognition"]
    )
    wired_table_cells_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["wiredTableCellsDetection"])
    wireless_table_cells_root = _resolve_cached_model_root(
        runtime_config.model_cache_dir, preset["wirelessTableCellsDetection"]
    )
    formula_recognition_root = _resolve_cached_model_root(runtime_config.model_cache_dir, preset["formulaRecognition"])
    ocr_engine = paddleocr.PaddleOCR(
        doc_orientation_classify_model_name=_paddle_model_name(preset["docOrientation"]),
        doc_orientation_classify_model_dir=str(doc_orientation_root),
        doc_unwarping_model_name=_paddle_model_name(preset["docUnwarping"]),
        doc_unwarping_model_dir=str(doc_unwarping_root),
        text_detection_model_name=_paddle_model_name(preset["detection"]),
        text_detection_model_dir=str(detection_root),
        textline_orientation_model_name=_paddle_model_name(preset["textlineOrientation"]),
        textline_orientation_model_dir=str(textline_orientation_root),
        text_recognition_model_name=_paddle_model_name(preset["recognition"]),
        text_recognition_model_dir=str(recognition_root),
        use_doc_orientation_classify=True,
        use_doc_unwarping=True,
        use_textline_orientation=True,
        device=_resolve_paddle_device(device),
    )
    layout_engine = paddleocr.PPStructureV3(
        layout_detection_model_name=_paddle_model_name(preset["layout"]),
        layout_detection_model_dir=str(layout_root),
        region_detection_model_name=_paddle_model_name(preset["region"]),
        region_detection_model_dir=str(region_root),
        doc_orientation_classify_model_name=_paddle_model_name(preset["docOrientation"]),
        doc_orientation_classify_model_dir=str(doc_orientation_root),
        doc_unwarping_model_name=_paddle_model_name(preset["docUnwarping"]),
        doc_unwarping_model_dir=str(doc_unwarping_root),
        text_detection_model_name=_paddle_model_name(preset["detection"]),
        text_detection_model_dir=str(detection_root),
        textline_orientation_model_name=_paddle_model_name(preset["textlineOrientation"]),
        textline_orientation_model_dir=str(textline_orientation_root),
        text_recognition_model_name=_paddle_model_name(preset["recognition"]),
        text_recognition_model_dir=str(recognition_root),
        table_classification_model_name=_paddle_model_name(preset["tableClassification"]),
        table_classification_model_dir=str(table_classification_root),
        wired_table_structure_recognition_model_name=_paddle_model_name(preset["wiredTableStructureRecognition"]),
        wired_table_structure_recognition_model_dir=str(wired_table_structure_root),
        wireless_table_structure_recognition_model_name=_paddle_model_name(preset["wirelessTableStructureRecognition"]),
        wireless_table_structure_recognition_model_dir=str(wireless_table_structure_root),
        wired_table_cells_detection_model_name=_paddle_model_name(preset["wiredTableCellsDetection"]),
        wired_table_cells_detection_model_dir=str(wired_table_cells_root),
        wireless_table_cells_detection_model_name=_paddle_model_name(preset["wirelessTableCellsDetection"]),
        wireless_table_cells_detection_model_dir=str(wireless_table_cells_root),
        table_orientation_classify_model_name=_paddle_model_name(preset["docOrientation"]),
        table_orientation_classify_model_dir=str(doc_orientation_root),
        formula_recognition_model_name=_paddle_model_name(preset["formulaRecognition"]),
        formula_recognition_model_dir=str(formula_recognition_root),
        use_doc_orientation_classify=True,
        use_doc_unwarping=True,
        use_textline_orientation=True,
        use_table_recognition=True,
        use_formula_recognition=True,
        use_region_detection=True,
        use_chart_recognition=False,
        use_seal_recognition=False,
        device=_resolve_paddle_device(device),
    )
    return LoadedOcrRuntime(
        model_root=Path(model_path),
        preferred_device=preferred_device,
        ocr_engine=ocr_engine,
        layout_engine=layout_engine,
        device=device,
    )


def load_local_caption_runtime(model_path: Path, *, preferred_device: str) -> LoadedCaptionRuntime:
    device = _resolve_device(preferred_device)
    _prime_transformers_local_remote_code_cache(Path(model_path))
    model = AutoModelForCausalLM.from_pretrained(
        str(model_path),
        trust_remote_code=True,
        dtype=_resolve_dtype(device),
    ).to(device).eval()
    return LoadedCaptionRuntime(
        model_root=Path(model_path),
        preferred_device=preferred_device,
        model=model,
        device=device,
    )


def analyze_local_ocr_image(runtime: LoadedOcrRuntime, source_path: str) -> dict[str, object]:
    if runtime.ocr_engine is None:
        raise RuntimeError("ocr image runtime is not configured")
    image = Image.open(source_path).convert("RGB")
    close = getattr(image, "close", None)
    if callable(close):
        close()
    ocr_output = runtime.ocr_engine.predict(source_path)
    layout_output = [] if runtime.layout_engine is None else runtime.layout_engine.predict(source_path)
    text_lines, ocr_regions = _collect_ocr_lines_and_regions(ocr_output)
    layout_regions = _collect_layout_regions(layout_output)
    return {
        "text": "\n".join(text_lines).strip(),
        "page": "",
        "regions": layout_regions or ocr_regions,
        "debug": _summarize_ocr_debug(ocr_output, layout_output),
    }


def analyze_moondream_caption_image(
    runtime: LoadedCaptionRuntime,
    source_path: str,
) -> dict[str, object]:
    if runtime.model is None:
        raise RuntimeError("caption image runtime is not configured")
    image = Image.open(source_path).convert("RGB")
    result = runtime.model.caption(image, length="short")
    if isinstance(result, dict):
        caption = str(result.get("caption") or "")
    else:
        caption = str(result)
    return {"caption": caption}


def _resolve_device(preferred_device: str) -> str:
    if preferred_device == "cuda" and torch.cuda.is_available():
        return "cuda"
    if preferred_device == "mps" and torch.backends.mps.is_available():
        return "mps"
    return "cpu"


def _resolve_ocr_device(preferred_device: str) -> str:
    if preferred_device == "cuda" and torch.cuda.is_available():
        return "cuda"
    return "cpu"


def _resolve_paddle_device(device: str) -> str:
    if device == "cuda":
        return "gpu"
    return "cpu"


def _resolve_dtype(device: str) -> torch.dtype:
    if device == "cuda":
        return torch.bfloat16
    return torch.float32


def _prime_transformers_local_remote_code_cache(model_path: Path) -> None:
    from transformers.dynamic_module_utils import _sanitize_module_name, create_dynamic_module
    from transformers.utils import HF_MODULES_CACHE, TRANSFORMERS_DYNAMIC_MODULE_NAME

    if not model_path.is_dir():
        return

    python_files = sorted(model_path.glob("*.py"))
    if not python_files:
        return

    submodule = _sanitize_module_name(model_path.name)
    full_submodule = f"{TRANSFORMERS_DYNAMIC_MODULE_NAME}/{submodule}"
    create_dynamic_module(full_submodule)
    destination_root = Path(HF_MODULES_CACHE) / full_submodule

    for source in python_files:
        destination = destination_root / source.name
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists() or source.read_bytes() != destination.read_bytes():
            shutil.copy(source, destination)

    importlib.invalidate_caches()


def _import_paddleocr():
    try:
        return importlib.import_module("paddleocr")
    except ModuleNotFoundError as error:
        raise ImportError(
            "PP-OCRv4 mobile runtime requires the `paddleocr` package. Run `pip install paddleocr`."
        ) from error


def _paddle_model_name(model_id: str) -> str:
    return model_id.rsplit("/", 1)[-1]


def _resolve_cached_model_root(cache_dir: Path, model_id: str) -> Path:
    return Path(cache_dir) / Path(*model_id.split("/"))


def _unwrap_prediction_item(value: object) -> object:
    if isinstance(value, Mapping) and "res" in value:
        return value["res"]
    if hasattr(value, "res"):
        return getattr(value, "res")
    return value


def _collect_ocr_lines_and_regions(value: object) -> tuple[list[str], list[dict[str, object]]]:
    texts: list[str] = []
    regions: list[dict[str, object]] = []

    for item in _iterate_prediction_items(value):
        payload = _unwrap_prediction_item(item)
        if not isinstance(payload, Mapping):
            continue
        rec_texts = payload.get("rec_texts")
        rec_boxes = payload.get("rec_boxes")
        if not isinstance(rec_texts, list):
            continue
        boxes = rec_boxes if isinstance(rec_boxes, list) else []
        for index, text in enumerate(rec_texts):
            normalized = str(text).strip()
            if not normalized:
                continue
            texts.append(normalized)
            bbox = boxes[index] if index < len(boxes) else None
            regions.append({"id": f"ocr-{len(regions)}", "bbox": bbox, "text": normalized})

    return texts, regions


def _collect_layout_regions(value: object) -> list[dict[str, object]]:
    regions: list[dict[str, object]] = []

    for item in _iterate_prediction_items(value):
        payload = _unwrap_prediction_item(item)
        if not isinstance(payload, Mapping):
            continue
        layout_items = payload.get("layout")
        parsing_items = payload.get("parsing_res_list")
        if isinstance(layout_items, list):
            for layout_item in layout_items:
                if not isinstance(layout_item, Mapping):
                    continue
                text = str(layout_item.get("text") or "").strip()
                if not text:
                    continue
                regions.append(
                    {
                        "id": f"layout-{len(regions)}",
                        "bbox": layout_item.get("bbox"),
                        "text": text,
                    }
                )
        if isinstance(parsing_items, list):
            for parsing_item in parsing_items:
                if not isinstance(parsing_item, Mapping):
                    continue
                text = str(parsing_item.get("block_text") or parsing_item.get("block_content") or "").strip()
                if not text:
                    continue
                regions.append(
                    {
                        "id": f"layout-{len(regions)}",
                        "bbox": parsing_item.get("block_bbox"),
                        "text": text,
                    }
                )

    return regions


def _iterate_prediction_items(value: object) -> Iterable[object]:
    if value is None:
        return ()
    if isinstance(value, (list, tuple)):
        return value
    return (value,)


def _summarize_ocr_debug(ocr_output: object, layout_output: object) -> dict[str, object]:
    ocr_payload = _first_mapping_payload(ocr_output)
    layout_payload = _first_mapping_payload(layout_output)
    return {
        "ocrPayloadKeys": sorted(str(key) for key in ocr_payload.keys())[:20],
        "layoutPayloadKeys": sorted(str(key) for key in layout_payload.keys())[:20],
        "ocrPreviewTexts": _extract_preview_texts(ocr_payload.get("rec_texts")),
        "layoutPreviewTexts": _extract_layout_preview_texts(
            layout_payload.get("layout"),
            layout_payload.get("parsing_res_list"),
        ),
    }


def _first_mapping_payload(value: object) -> Mapping[str, object]:
    for item in _iterate_prediction_items(value):
        payload = _unwrap_prediction_item(item)
        if isinstance(payload, Mapping):
            return payload
    return {}


def _extract_preview_texts(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    result: list[str] = []
    for item in value:
        text = str(item).strip()
        if text:
            result.append(text)
        if len(result) >= 12:
            break
    return result


def _extract_layout_preview_texts(layout_value: object, parsing_value: object) -> list[str]:
    result: list[str] = []
    if isinstance(layout_value, list):
        for item in layout_value:
            if not isinstance(item, Mapping):
                continue
            text = str(item.get("text") or "").strip()
            if text:
                result.append(text)
            if len(result) >= 12:
                return result
    if isinstance(parsing_value, list):
        for item in parsing_value:
            if not isinstance(item, Mapping):
                continue
            text = str(item.get("block_text") or item.get("block_content") or "").strip()
            if text:
                result.append(text)
            if len(result) >= 12:
                return result
    return result
