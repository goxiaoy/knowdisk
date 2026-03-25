from __future__ import annotations

from pathlib import Path

import torch
from PIL import Image
from transformers import AutoModelForCausalLM, AutoProcessor

from worker.model.types import LoadedCaptionRuntime, LoadedOcrRuntime


def load_local_ocr_runtime(model_path: Path, *, preferred_device: str) -> LoadedOcrRuntime:
    device = _resolve_device(preferred_device)
    model = AutoModelForCausalLM.from_pretrained(
        str(model_path),
        trust_remote_code=True,
        torch_dtype=_resolve_dtype(device),
    ).to(device).eval()
    processor = AutoProcessor.from_pretrained(str(model_path), trust_remote_code=True)
    return LoadedOcrRuntime(
        model_root=Path(model_path),
        preferred_device=preferred_device,
        model=model,
        processor=processor,
        device=device,
    )


def load_local_caption_runtime(model_path: Path, *, preferred_device: str) -> LoadedCaptionRuntime:
    device = _resolve_device(preferred_device)
    model = AutoModelForCausalLM.from_pretrained(
        str(model_path),
        trust_remote_code=True,
        torch_dtype=_resolve_dtype(device),
    ).to(device).eval()
    return LoadedCaptionRuntime(
        model_root=Path(model_path),
        preferred_device=preferred_device,
        model=model,
        device=device,
    )


def analyze_paddleocr_vl_image(runtime: LoadedOcrRuntime, source_path: str) -> dict[str, object]:
    if runtime.model is None or runtime.processor is None:
        raise RuntimeError("ocr image runtime is not configured")
    image = Image.open(source_path).convert("RGB")
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "image": image},
                {"type": "text", "text": "OCR:"},
            ],
        }
    ]
    inputs = runtime.processor.apply_chat_template(
        messages,
        tokenize=True,
        add_generation_prompt=True,
        return_dict=True,
        return_tensors="pt",
    ).to(runtime.device)
    outputs = runtime.model.generate(
        **inputs,
        max_new_tokens=1024,
        do_sample=False,
        use_cache=True,
    )
    text = runtime.processor.batch_decode(outputs, skip_special_tokens=True)[0].strip()
    return {
        "text": text,
        "page": "",
        "regions": [],
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


def _resolve_dtype(device: str) -> torch.dtype:
    if device == "cuda":
        return torch.bfloat16
    return torch.float32
