from __future__ import annotations

import sqlite3
from pathlib import Path
from typing import cast

from worker.runtime.types import IndexStatusSnapshot, create_default_index_status_snapshot

_MISSING = object()


class SQLiteIndexQueueStore:
    def __init__(self, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    def snapshot(self) -> IndexStatusSnapshot:
        with self._connect() as connection:
            row = self._read_snapshot_row(connection)
            if row is None:
                return create_default_index_status_snapshot()
            return self._row_to_snapshot(row)

    def update(
        self,
        *,
        phase: str | None = None,
        scope: str | None | object = _MISSING,
        queueDepth: int | None = None,
        processedFiles: int | None = None,
        totalFiles: int | None = None,
        activeNodeName: str | None = None,
        error: str | None = None,
        available: bool | None = None,
    ) -> IndexStatusSnapshot:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            next_snapshot = self._read_snapshot(connection)
            if phase is not None:
                next_snapshot["phase"] = phase
            if scope is not _MISSING:
                next_snapshot["scope"] = scope
            if queueDepth is not None:
                next_snapshot["queueDepth"] = queueDepth
            if processedFiles is not None:
                next_snapshot["processedFiles"] = processedFiles
            if totalFiles is not None:
                next_snapshot["totalFiles"] = totalFiles
            if activeNodeName is not None:
                next_snapshot["activeNodeName"] = activeNodeName
            if error is not None:
                next_snapshot["error"] = error
            next_snapshot["available"] = True if available is None else available
            self._persist(connection, next_snapshot)
            return next_snapshot

    def reserve_incremental(self, node_name: str) -> IndexStatusSnapshot:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE index_queue_snapshot
                SET available = 1,
                    phase = 'indexing',
                    scope = 'incremental',
                    queueDepth = queueDepth + 1,
                    processedFiles = 0,
                    totalFiles = 1,
                    activeNodeName = ?,
                    error = ''
                WHERE id = 1
                """,
                (node_name,),
            )
            snapshot = self._read_snapshot(connection)
            self._persist(connection, snapshot)
            return snapshot

    def complete_incremental(self) -> IndexStatusSnapshot:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            connection.execute(
                """
                UPDATE index_queue_snapshot
                SET available = 1,
                    phase = 'idle',
                    scope = NULL,
                    queueDepth = CASE
                        WHEN queueDepth > 0 THEN queueDepth - 1
                        ELSE 0
                    END,
                    processedFiles = 1,
                    totalFiles = 1,
                    activeNodeName = '',
                    error = ''
                WHERE id = 1
                """
            )
            snapshot = self._read_snapshot(connection)
            self._persist(connection, snapshot)
            return snapshot

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS index_queue_snapshot (
                    id INTEGER PRIMARY KEY CHECK (id = 1),
                    available INTEGER NOT NULL,
                    phase TEXT NOT NULL,
                    scope TEXT,
                    queueDepth INTEGER NOT NULL,
                    processedFiles INTEGER NOT NULL,
                    totalFiles INTEGER NOT NULL,
                    activeNodeName TEXT NOT NULL,
                    error TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                INSERT OR IGNORE INTO index_queue_snapshot (
                    id, available, phase, scope, queueDepth,
                    processedFiles, totalFiles, activeNodeName, error
                ) VALUES (1, 0, 'idle', NULL, 0, 0, 0, '', '')
                """
            )

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db_path, timeout=30)
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection

    def _read_snapshot(self, connection: sqlite3.Connection) -> IndexStatusSnapshot:
        row = self._read_snapshot_row(connection)
        if row is None:
            return create_default_index_status_snapshot()
        return self._row_to_snapshot(row)

    def _read_snapshot_row(self, connection: sqlite3.Connection) -> tuple[object, ...] | None:
        return connection.execute(
            """
            SELECT available, phase, scope, queueDepth, processedFiles,
                   totalFiles, activeNodeName, error
            FROM index_queue_snapshot
            WHERE id = 1
            """
        ).fetchone()

    def _row_to_snapshot(self, row: tuple[object, ...]) -> IndexStatusSnapshot:
        return cast(
            IndexStatusSnapshot,
            {
                "available": bool(row[0]),
                "phase": str(row[1]),
                "scope": row[2],
                "queueDepth": int(row[3]),
                "processedFiles": int(row[4]),
                "totalFiles": int(row[5]),
                "activeNodeName": str(row[6]),
                "error": str(row[7]),
            },
        )

    def _persist(self, connection: sqlite3.Connection, snapshot: IndexStatusSnapshot) -> None:
        connection.execute(
            """
            UPDATE index_queue_snapshot
            SET available = ?,
                phase = ?,
                scope = ?,
                queueDepth = ?,
                processedFiles = ?,
                totalFiles = ?,
                activeNodeName = ?,
                error = ?
            WHERE id = 1
            """,
            (
                1 if snapshot["available"] else 0,
                snapshot["phase"],
                snapshot["scope"],
                snapshot["queueDepth"],
                snapshot["processedFiles"],
                snapshot["totalFiles"],
                snapshot["activeNodeName"],
                snapshot["error"],
            ),
        )
