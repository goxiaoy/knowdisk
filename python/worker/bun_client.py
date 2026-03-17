from __future__ import annotations

import base64
import os
import tempfile
from collections.abc import Callable, Iterator
from contextlib import contextmanager
from typing import Any


class BunClient:
    def __init__(self, request: Callable[[str, dict[str, Any]], dict[str, Any]]) -> None:
        self._request = request

    def get_node_metadata(self, node_id: str) -> dict[str, Any]:
        return self._request("get_node_metadata", {"nodeId": node_id})

    def read_node_content(self, node_id: str) -> bytes:
        response = self._request("read_node_content", {"nodeId": node_id})
        return base64.b64decode(response["content"])

    @contextmanager
    def materialize_node_file(self, node_id: str, suffix: str = "") -> Iterator[str]:
        content = self.read_node_content(node_id)
        file_descriptor, path = tempfile.mkstemp(suffix=suffix)
        try:
            with os.fdopen(file_descriptor, "wb") as handle:
                handle.write(content)
            yield path
        finally:
            if os.path.exists(path):
                os.unlink(path)
