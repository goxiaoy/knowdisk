from __future__ import annotations

import json
import resource
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


def get_process_rss_mb() -> int:
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes, Linux reports KiB.
    if rss > 1_000_000_000:
        return max(1, int(rss / (1024 * 1024)))
    return max(1, int(rss / 1024))
