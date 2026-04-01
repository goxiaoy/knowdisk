from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Mapping
from pathlib import Path
from typing import Literal, TypeAlias

from worker.model.model_specs import resolve_ocr_preset

ModelArtifactKind: TypeAlias = Literal["embedding", "reranker", "ocr", "caption"]
ModelPreferredDevice: TypeAlias = Literal["cpu", "mps", "cuda"]

DEFAULT_OCR_MODEL = "PaddlePaddle/PP-OCRv4_mobile"
DEFAULT_OCR_DETECTION_MODEL = "PaddlePaddle/PP-OCRv4_mobile_det"
DEFAULT_OCR_RECOGNITION_MODEL = "PaddlePaddle/PP-OCRv4_mobile_rec"
DEFAULT_OCR_LAYOUT_MODEL = "PaddlePaddle/PP-DocLayout_plus-L"
DEFAULT_OCR_REGION_MODEL = "PaddlePaddle/PP-DocBlockLayout"
DEFAULT_OCR_DOC_ORIENTATION_MODEL = "PaddlePaddle/PP-LCNet_x1_0_doc_ori"
DEFAULT_OCR_TEXTLINE_ORIENTATION_MODEL = "PaddlePaddle/PP-LCNet_x1_0_textline_ori"
DEFAULT_OCR_MODEL_DISPLAY = DEFAULT_OCR_MODEL


@dataclass(frozen=True, slots=True)
class ModelRuntimeConfig:
    base_path: Path
    embedding_model: str
    reranker_model: str
    ocr_model: str
    ocr_detection_model: str
    ocr_recognition_model: str
    ocr_layout_model: str
    ocr_region_model: str
    ocr_doc_orientation_model: str
    ocr_textline_orientation_model: str
    ocr_enable_table_recognition: bool
    ocr_enable_formula_recognition: bool
    caption_model: str
    preferred_device: ModelPreferredDevice
    model_cache_dir: Path
    huggingface_endpoint: str = ""

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ModelRuntimeConfig:
        preferred_device = str(value["preferredDevice"])
        if preferred_device not in {"cpu", "mps", "cuda"}:
            raise ValueError(f"invalid preferred device: {preferred_device}")

        (
            ocr_detection_model,
            ocr_recognition_model,
            ocr_layout_model,
            ocr_region_model,
            ocr_doc_orientation_model,
            ocr_textline_orientation_model,
        ) = _extract_ocr_models(value)
        ocr_model = _extract_ocr_model(value)
        caption_model = _extract_model_id(value, "caption", fallback="vikhyatk/moondream2")
        huggingface_endpoint = value.get("huggingfaceEndpoint")
        return cls(
            base_path=Path(str(value["basePath"])),
            embedding_model=str(value["embeddingModel"]),
            reranker_model=str(value["rerankerModel"]),
            ocr_model=ocr_model,
            ocr_detection_model=ocr_detection_model,
            ocr_recognition_model=ocr_recognition_model,
            ocr_layout_model=ocr_layout_model,
            ocr_region_model=ocr_region_model,
            ocr_doc_orientation_model=ocr_doc_orientation_model,
            ocr_textline_orientation_model=ocr_textline_orientation_model,
            ocr_enable_table_recognition=_extract_ocr_feature_flag(value, "enableTableRecognition"),
            ocr_enable_formula_recognition=_extract_ocr_feature_flag(value, "enableFormulaRecognition"),
            caption_model=caption_model,
            preferred_device=preferred_device,
            model_cache_dir=Path(str(value["basePath"])) / "model",
            huggingface_endpoint="" if huggingface_endpoint is None else str(huggingface_endpoint),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        result: dict[str, object] = {
            "basePath": str(self.base_path),
            "embeddingModel": self.embedding_model,
            "rerankerModel": self.reranker_model,
            "ocrModel": self.ocr_model,
            "ocrDetectionModel": self.ocr_detection_model,
            "ocrRecognitionModel": self.ocr_recognition_model,
            "ocrLayoutModel": self.ocr_layout_model,
            "ocrRegionModel": self.ocr_region_model,
            "ocrDocOrientationModel": self.ocr_doc_orientation_model,
            "ocrTextlineOrientationModel": self.ocr_textline_orientation_model,
            "ocrEnableTableRecognition": self.ocr_enable_table_recognition,
            "ocrEnableFormulaRecognition": self.ocr_enable_formula_recognition,
            "captionModel": self.caption_model,
            "preferredDevice": self.preferred_device,
            "modelCacheDir": str(self.model_cache_dir),
        }
        if self.huggingface_endpoint:
            result["huggingfaceEndpoint"] = self.huggingface_endpoint
        return result


@dataclass(frozen=True, slots=True)
class ModelRepoFile:
    path: str
    size: int

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ModelRepoFile:
        return cls(
            path=str(value["rfilename"]),
            size=_normalize_repo_file_size(value),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        return {
            "rfilename": self.path,
            "size": self.size,
        }


@dataclass(frozen=True, slots=True)
class LoadedRerankerRuntime:
    tokenizer: object
    model: object


@dataclass(frozen=True, slots=True)
class LoadedOcrRuntime:
    model_root: Path
    preferred_device: ModelPreferredDevice
    ocr_engine: object | None = None
    layout_engine: object | None = None
    device: str = "cpu"


@dataclass(frozen=True, slots=True)
class LoadedCaptionRuntime:
    model_root: Path
    preferred_device: ModelPreferredDevice
    model: object | None = None
    device: str = "cpu"


def _normalize_size(value: object) -> int:
    if isinstance(value, int) and value > 0:
        return value
    if isinstance(value, float) and value.is_integer() and value > 0:
        return int(value)
    return 0


def _normalize_repo_file_size(value: Mapping[str, object]) -> int:
    direct_size = _normalize_size(value.get("size"))
    if direct_size > 0:
        return direct_size

    lfs_value = value.get("lfs")
    if isinstance(lfs_value, Mapping):
        return _normalize_size(lfs_value.get("size"))

    return 0


def _extract_model_id(value: Mapping[str, object], kind: str, *, fallback: str) -> str:
    top_level_key = f"{kind}Model"
    top_level_value = value.get(top_level_key)
    if isinstance(top_level_value, str) and top_level_value.strip():
        return top_level_value

    core_config_value = value.get("coreConfig")
    if core_config_value is None:
        return fallback
    if not isinstance(core_config_value, Mapping):
        raise ValueError(f"missing required {kind} model configuration")

    section_value = core_config_value.get(kind)
    if not isinstance(section_value, Mapping):
        raise ValueError(f"missing required {kind} model configuration")

    local_value = section_value.get("local")
    if not isinstance(local_value, Mapping):
        raise ValueError(f"missing required {kind} model configuration")

    model_value = local_value.get("model")
    if not isinstance(model_value, str) or not model_value.strip():
        return fallback

    return model_value


def _extract_ocr_models(value: Mapping[str, object]) -> tuple[str, str, str, str, str, str]:
    ocr_model = _extract_ocr_model(value)
    preset = resolve_ocr_preset(ocr_model)
    return (
        preset["detection"],
        preset["recognition"],
        preset["layout"],
        preset["region"],
        preset["docOrientation"],
        preset["textlineOrientation"],
    )


def _extract_ocr_model(value: Mapping[str, object]) -> str:
    core_config_value = value.get("coreConfig")
    if not isinstance(core_config_value, Mapping):
        return DEFAULT_OCR_MODEL

    ocr_value = core_config_value.get("ocr")
    if not isinstance(ocr_value, Mapping):
        return DEFAULT_OCR_MODEL

    local_value = ocr_value.get("local")
    if not isinstance(local_value, Mapping):
        return DEFAULT_OCR_MODEL

    model = local_value.get("model")
    if isinstance(model, str) and model.strip():
        return model
    return DEFAULT_OCR_MODEL


def _extract_ocr_feature_flag(value: Mapping[str, object], key: str) -> bool:
    core_config_value = value.get("coreConfig")
    if not isinstance(core_config_value, Mapping):
        return False

    ocr_value = core_config_value.get("ocr")
    if not isinstance(ocr_value, Mapping):
        return False

    local_value = ocr_value.get("local")
    if not isinstance(local_value, Mapping):
        return False

    flag = local_value.get(key)
    if isinstance(flag, bool):
        return flag
    return False
