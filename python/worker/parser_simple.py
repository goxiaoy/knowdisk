from __future__ import annotations

import json
from pathlib import Path
from typing import Any


def parse_simple_document(node: dict[str, Any], content: bytes) -> list[dict[str, Any]]:
    name = str(node["name"])
    title = Path(name).stem
    text = normalize_simple_content(name=name, content=content)

    if not text.strip():
        return [
            {
                "status": "skipped",
                "chunkIndex": 0,
                "text": "",
                "title": title,
                "source": {
                    "nodeId": node["nodeId"],
                    "name": name,
                },
                "error": {
                    "code": "EMPTY_CONTENT",
                    "message": "simple parser content is empty",
                },
            }
        ]

    return [
        {
            "status": "ok",
            "chunkIndex": 0,
            "text": text,
            "title": title,
            "source": {
                "nodeId": node["nodeId"],
                "name": name,
            },
        }
    ]


def normalize_simple_content(name: str, content: bytes) -> str:
    suffix = Path(name).suffix.lower()
    decoded = content.decode("utf-8", errors="ignore")

    if suffix == ".json":
        parsed = json.loads(decoded or "{}")
        return json.dumps(parsed, ensure_ascii=True, indent=2, sort_keys=True)

    return decoded.strip()
