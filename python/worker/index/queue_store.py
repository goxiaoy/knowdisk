from __future__ import annotations

import sqlite3
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from worker.runtime.types import IndexStatusSnapshot, create_default_index_status_snapshot


@dataclass(frozen=True, slots=True)
class QueueJob:
    job_id: int
    node_id: str
    job_type: str
    payload_json: str


@dataclass(frozen=True, slots=True)
class QueueClaimResult:
    job: QueueJob | None
    cancelled_job_ids: tuple[int, ...] = ()


@dataclass(frozen=True, slots=True)
class QueueEnqueueResult:
    job: QueueJob
    status: str


class SQLiteIndexQueueStore:
    def __init__(self, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @property
    def db_path(self) -> Path:
        return self._db_path

    def snapshot(self) -> IndexStatusSnapshot:
        with self._connect() as connection:
            return self._snapshot_from_connection(connection)

    def enqueue_job(
        self,
        node_id: str,
        job_type: str,
        payload_json: str = "{}",
    ) -> QueueEnqueueResult:
        if job_type not in {"index", "delete"}:
            raise ValueError(f"unsupported job type: {job_type}")

        now = _now_iso()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            state_row = self._read_node_state_row(connection, node_id)
            if state_row is not None:
                latest_job_id = int(state_row[0])
                latest_desired_type = str(state_row[1])
                if latest_desired_type == job_type and self._is_live_job(
                    connection, latest_job_id
                ):
                    status_row = connection.execute(
                        "SELECT status FROM index_jobs WHERE job_id = ?",
                        (latest_job_id,),
                    ).fetchone()
                    live_status = "" if status_row is None else str(status_row[0])
                    connection.execute(
                        """
                        UPDATE index_node_state
                        SET payload_json = ?,
                            version = version + 1,
                            updated_at = ?
                        WHERE node_id = ?
                        """,
                        (payload_json, now, node_id),
                    )
                    return QueueEnqueueResult(
                        job=self._read_job(connection, latest_job_id),
                        status=live_status,
                    )

            cursor = connection.execute(
                """
                INSERT INTO index_jobs (
                    node_id, job_type, payload_json, status,
                    created_at, updated_at, started_at, finished_at, error
                ) VALUES (?, ?, ?, 'queued', ?, ?, NULL, NULL, '')
                """,
                (node_id, job_type, payload_json, now, now),
            )
            job_id = int(cursor.lastrowid)
            connection.execute(
                """
                INSERT INTO index_node_state (
                    node_id, latest_job_id, desired_type, payload_json,
                    version, updated_at
                ) VALUES (?, ?, ?, ?, 1, ?)
                ON CONFLICT(node_id) DO UPDATE SET
                    latest_job_id = excluded.latest_job_id,
                    desired_type = excluded.desired_type,
                    payload_json = excluded.payload_json,
                    version = index_node_state.version + 1,
                    updated_at = excluded.updated_at
                """,
                (node_id, job_id, job_type, payload_json, now),
            )
            return QueueEnqueueResult(
                job=QueueJob(
                    job_id=job_id,
                    node_id=node_id,
                    job_type=job_type,
                    payload_json=payload_json,
                ),
                status="queued",
            )

    def claim_next_job(self) -> QueueClaimResult:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            cancelled_job_ids: list[int] = []
            while True:
                row = connection.execute(
                    """
                    SELECT job_id, node_id, job_type, payload_json
                    FROM index_jobs
                    WHERE status = 'queued'
                    ORDER BY job_id
                    LIMIT 1
                    """
                ).fetchone()
                if row is None:
                    return QueueClaimResult(job=None, cancelled_job_ids=tuple(cancelled_job_ids))

                job = QueueJob(
                    job_id=int(row[0]),
                    node_id=str(row[1]),
                    job_type=str(row[2]),
                    payload_json=str(row[3]),
                )
                state_row = self._read_node_state_row(connection, job.node_id)
                if state_row is None or int(state_row[0]) != job.job_id or str(state_row[1]) != job.job_type:
                    self._mark_job_cancelled(connection, job.job_id, "stale")
                    cancelled_job_ids.append(job.job_id)
                    continue

                now = _now_iso()
                connection.execute(
                    """
                    UPDATE index_jobs
                    SET status = 'running',
                        started_at = COALESCE(started_at, ?),
                        updated_at = ?
                    WHERE job_id = ?
                    """,
                    (now, now, job.job_id),
                )
                return QueueClaimResult(job=job, cancelled_job_ids=tuple(cancelled_job_ids))

    def mark_done(self, job_id: int) -> None:
        self._mark_terminal(job_id, "done", error="")

    def mark_failed(self, job_id: int, error: str) -> None:
        self._mark_terminal(job_id, "failed", error=error)

    def mark_cancelled(self, job_id: int, error: str = "stale") -> None:
        self._mark_terminal(job_id, "cancelled", error=error)

    def _mark_terminal(self, job_id: int, status: str, *, error: str) -> None:
        now = _now_iso()
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE index_jobs
                SET status = ?,
                    finished_at = ?,
                    updated_at = ?,
                    error = ?
                WHERE job_id = ?
                """,
                (status, now, now, error, job_id),
            )

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS index_jobs (
                    job_id INTEGER PRIMARY KEY AUTOINCREMENT,
                    node_id TEXT NOT NULL,
                    job_type TEXT NOT NULL CHECK (job_type IN ('index', 'delete')),
                    payload_json TEXT NOT NULL,
                    status TEXT NOT NULL CHECK (
                        status IN ('queued', 'running', 'done', 'failed', 'cancelled')
                    ),
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    started_at TEXT,
                    finished_at TEXT,
                    error TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS index_node_state (
                    node_id TEXT PRIMARY KEY,
                    latest_job_id INTEGER NOT NULL,
                    desired_type TEXT NOT NULL CHECK (desired_type IN ('index', 'delete')),
                    payload_json TEXT NOT NULL,
                    version INTEGER NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    def _snapshot_from_connection(self, connection: sqlite3.Connection) -> IndexStatusSnapshot:
        has_state = connection.execute(
            "SELECT 1 FROM index_node_state LIMIT 1"
        ).fetchone() is not None
        has_jobs = connection.execute(
            "SELECT 1 FROM index_jobs LIMIT 1"
        ).fetchone() is not None
        if not has_state and not has_jobs:
            return create_default_index_status_snapshot()

        queued_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM index_jobs WHERE status = 'queued'"
            ).fetchone()[0]
        )
        running_row = connection.execute(
            """
            SELECT node_id
            FROM index_jobs
            WHERE status = 'running'
            ORDER BY started_at, job_id
            LIMIT 1
            """
        ).fetchone()

        running_count = int(
            connection.execute(
                "SELECT COUNT(*) FROM index_jobs WHERE status = 'running'"
            ).fetchone()[0]
        )
        if running_count > 0:
            phase = "indexing"
            scope = "incremental"
            processed_files = 0
            total_files = 1
            active_node_name = "" if running_row is None else str(running_row[0])
        else:
            phase = "idle"
            scope = None
            processed_files = 1
            total_files = 1
            active_node_name = ""
        return cast(
            IndexStatusSnapshot,
            {
                "available": True,
                "phase": phase,
                "scope": scope,
                "queueDepth": queued_count,
                "processedFiles": processed_files,
                "totalFiles": total_files,
                "activeNodeName": active_node_name,
                "error": "",
            },
        )

    def _is_live_job(self, connection: sqlite3.Connection, job_id: int) -> bool:
        row = connection.execute(
            "SELECT status FROM index_jobs WHERE job_id = ?",
            (job_id,),
        ).fetchone()
        return row is not None and str(row[0]) in {"queued", "running"}

    def _read_node_state_row(
        self, connection: sqlite3.Connection, node_id: str
    ) -> tuple[object, ...] | None:
        return connection.execute(
            """
            SELECT latest_job_id, desired_type, payload_json, version, updated_at
            FROM index_node_state
            WHERE node_id = ?
            """,
            (node_id,),
        ).fetchone()

    def _read_job(self, connection: sqlite3.Connection, job_id: int) -> QueueJob:
        row = connection.execute(
            """
            SELECT job_id, node_id, job_type, payload_json
            FROM index_jobs
            WHERE job_id = ?
            """,
            (job_id,),
        ).fetchone()
        if row is None:
            raise RuntimeError(f"missing job row: {job_id}")
        return QueueJob(
            job_id=int(row[0]),
            node_id=str(row[1]),
            job_type=str(row[2]),
            payload_json=str(row[3]),
        )

    def _mark_job_cancelled(
        self, connection: sqlite3.Connection, job_id: int, error: str
    ) -> None:
        now = _now_iso()
        connection.execute(
            """
            UPDATE index_jobs
            SET status = 'cancelled',
                finished_at = ?,
                updated_at = ?,
                error = ?
            WHERE job_id = ?
            """,
            (now, now, error, job_id),
        )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db_path, timeout=30)
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection


def _now_iso() -> str:
    from datetime import datetime, timezone

    return datetime.now(timezone.utc).isoformat()
