import json

import pytest

from worker.protocol import decode_frame, encode_frame, is_start_request_frame
from worker.protocol.types import PythonWorkerStartRequest


def test_encode_frame_returns_single_newline_terminated_json_line():
    payload = {"id": "req-1", "method": "index_node", "params": {"nodeId": "node-1"}}

    encoded = encode_frame(payload)

    assert encoded.endswith(b"\n")
    assert encoded.count(b"\n") == 1
    assert json.loads(encoded.decode("utf-8")) == payload


def test_decode_frame_parses_valid_request_response_and_event_frames():
    request = decode_frame(b'{"id":"req-1","method":"index_node","params":{"nodeId":"node-1"}}\n')
    response = decode_frame(b'{"id":"req-1","result":{"ok":true}}\n')
    event = decode_frame(b'{"type":"worker_health_changed","payload":{"ready":true}}\n')

    assert request["method"] == "index_node"
    assert response["result"] == {"ok": True}
    assert event["type"] == "worker_health_changed"


def test_decode_frame_preserves_start_payload_model_runtime_config():
    frame = decode_frame(
        b'{"id":"req-start","method":"start","params":{"basePath":"/tmp/knowdisk","embeddingModel":"Alibaba-NLP/gte-multilingual-base","rerankerModel":"Alibaba-NLP/gte-multilingual-reranker-base","preferredDevice":"cpu","huggingfaceEndpoint":"https://huggingface.co","coreConfig":{"embedding":{"provider":"local","local":{"model":"Alibaba-NLP/gte-multilingual-base","dimension":768}},"reranker":{"enabled":true,"provider":"local","local":{"model":"Alibaba-NLP/gte-multilingual-reranker-base","topN":5}},"ocr":{"provider":"local","local":{"model":"PaddlePaddle/PaddleOCR-VL"}},"caption":{"provider":"local","local":{"model":"vikhyatk/moondream2"}},"providers":{"huggingface":{"endpoint":"https://huggingface.co"}}}}}\n'
    )

    assert frame["method"] == "start"
    assert frame["params"]["embeddingModel"] == "Alibaba-NLP/gte-multilingual-base"
    assert frame["params"]["preferredDevice"] == "cpu"


def test_decode_frame_returns_typed_start_payload_shape():
    frame = decode_frame(
        b'{"id":"req-start","method":"start","params":{"basePath":"/tmp/knowdisk","embeddingModel":"Alibaba-NLP/gte-multilingual-base","rerankerModel":"Alibaba-NLP/gte-multilingual-reranker-base","preferredDevice":"cpu"}}\n'
    )

    assert is_start_request_frame(frame)
    typed_frame: PythonWorkerStartRequest = frame

    assert typed_frame["method"] == "start"
    assert typed_frame["params"]["basePath"] == "/tmp/knowdisk"


@pytest.mark.parametrize(
    "line",
    [
        b'{"id":"req-start","method":"start","params":{"basePath":"/tmp/knowdisk","embeddingModel":"Alibaba-NLP/gte-multilingual-base","rerankerModel":"Alibaba-NLP/gte-multilingual-reranker-base","preferredDevice":"cpu","coreConfig":{"embedding":{"provider":"local","local":{"model":"Alibaba-NLP/gte-multilingual-base"}},"reranker":{"enabled":true,"provider":"local","local":{"model":"Alibaba-NLP/gte-multilingual-reranker-base","topN":5}},"ocr":{"provider":"local","local":{"model":"PaddlePaddle/PaddleOCR-VL"}},"caption":{"provider":"local","local":{"model":"vikhyatk/moondream2"}},"providers":{}}}}\n',
        b'{"id":"req-start","method":"start","params":{"basePath":"/tmp/knowdisk","embeddingModel":"Alibaba-NLP/gte-multilingual-base","rerankerModel":"Alibaba-NLP/gte-multilingual-reranker-base","preferredDevice":"cpu","coreConfig":{"embedding":{"provider":"local","local":{"model":"Alibaba-NLP/gte-multilingual-base","dimension":768}},"reranker":{"enabled":true,"provider":"local","local":{"model":"Alibaba-NLP/gte-multilingual-reranker-base"}},"ocr":{"provider":"local","local":{"model":"PaddlePaddle/PaddleOCR-VL"}},"caption":{"provider":"local","local":{"model":"vikhyatk/moondream2"}},"providers":{}}}}\n',
    ],
)
def test_decode_frame_rejects_malformed_text_model_subsets(line: bytes):
    with pytest.raises(ValueError):
        decode_frame(line)


@pytest.mark.parametrize(
    "line",
    [
        b"",
        b"not-json\n",
        b'{"id":"","method":"start","params":{}}\n',
        b'{"id":"req-1"}\n',
        b'{"id":"req-1","result":{},"error":{"code":"X","message":"boom"}}\n',
        b'{"type":"","payload":{}}\n',
    ],
)
def test_decode_frame_rejects_invalid_json_and_invalid_shapes(line: bytes):
    with pytest.raises(ValueError):
        decode_frame(line)
