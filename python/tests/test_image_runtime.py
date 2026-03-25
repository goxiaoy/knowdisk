from pathlib import Path

from worker.model.image_runtime import (
    analyze_moondream_caption_image,
    analyze_paddleocr_vl_image,
    load_local_caption_runtime,
    load_local_ocr_runtime,
)
from worker.model.types import LoadedCaptionRuntime, LoadedOcrRuntime


class FakeImage:
    def convert(self, mode: str):
        assert mode == "RGB"
        return self


def test_load_local_ocr_runtime_loads_processor_and_model(monkeypatch, tmp_path: Path):
    calls: list[tuple[str, object, object]] = []

    class FakeProcessor:
        pass

    class FakeModel:
        def eval(self):
            calls.append(("eval", None, None))
            return self

        def to(self, device):
            calls.append(("to", device, None))
            return self

    monkeypatch.setattr(
        "worker.model.image_runtime.AutoProcessor.from_pretrained",
        lambda model_path, trust_remote_code: calls.append(("processor", model_path, trust_remote_code)) or FakeProcessor(),
    )
    monkeypatch.setattr(
        "worker.model.image_runtime.AutoModelForCausalLM.from_pretrained",
        lambda model_path, trust_remote_code, torch_dtype: calls.append(("model", model_path, torch_dtype)) or FakeModel(),
    )

    runtime = load_local_ocr_runtime(tmp_path, preferred_device="cpu")

    assert isinstance(runtime, LoadedOcrRuntime)
    assert runtime.model_root == tmp_path
    assert runtime.processor.__class__.__name__ == "FakeProcessor"
    assert runtime.model.__class__.__name__ == "FakeModel"
    assert runtime.device == "cpu"
    assert ("processor", str(tmp_path), True) in calls
    assert any(call[0] == "model" for call in calls)


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
        lambda model_path, trust_remote_code, torch_dtype: calls.append(("model", model_path, torch_dtype)) or FakeModel(),
    )

    runtime = load_local_caption_runtime(tmp_path, preferred_device="cpu")

    assert isinstance(runtime, LoadedCaptionRuntime)
    assert runtime.model_root == tmp_path
    assert runtime.model.__class__.__name__ == "FakeModel"
    assert runtime.device == "cpu"
    assert calls[0][0] == "model"


def test_analyze_paddleocr_vl_image_uses_ocr_prompt(monkeypatch, tmp_path: Path):
    source_path = tmp_path / "image.png"
    source_path.write_bytes(b"png")
    calls: list[tuple[str, object]] = []

    class FakeInputs(dict):
        def to(self, device):
            calls.append(("inputs.to", device))
            return self

    class FakeProcessor:
        def apply_chat_template(self, messages, **kwargs):
            calls.append(("messages", messages))
            calls.append(("template_kwargs", kwargs))
            return FakeInputs({"input_ids": [1]})

        def batch_decode(self, outputs, skip_special_tokens=True):
            calls.append(("decode", outputs))
            return ["Detected OCR text"]

    class FakeModel:
        def generate(self, **kwargs):
            calls.append(("generate", kwargs))
            return [[1, 2, 3]]

    monkeypatch.setattr("worker.model.image_runtime.Image.open", lambda path: FakeImage())

    runtime = LoadedOcrRuntime(
        model_root=tmp_path,
        preferred_device="cpu",
        model=FakeModel(),
        processor=FakeProcessor(),
        device="cpu",
    )

    result = analyze_paddleocr_vl_image(runtime, str(source_path))

    assert result == {"text": "Detected OCR text", "page": "", "regions": []}
    assert calls[0][0] == "messages"
    assert calls[0][1][0]["content"][1]["text"] == "OCR:"


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
