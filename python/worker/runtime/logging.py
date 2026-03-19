from __future__ import annotations

import json
from dataclasses import dataclass
from typing import TextIO


@dataclass(frozen=True, slots=True)
class WorkerLogger:
    stream: TextIO

    def log(self, level: str, msg: str, **fields: object) -> None:
        record: dict[str, object] = {
            "level": level,
            "msg": msg,
            "logger": "python-worker",
            **fields,
        }
        self.stream.write(json.dumps(record, separators=(",", ":")) + "\n")
        self.stream.flush()


def create_worker_logger(stream: TextIO) -> WorkerLogger:
    return WorkerLogger(stream=stream)
