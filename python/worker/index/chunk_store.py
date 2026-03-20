from __future__ import annotations

import sqlite3
from pathlib import Path

from worker.vector.types import VectorChunkRow, VectorRowEmbedding


class SQLiteChunkStore:
    def __init__(self, db_path: str | Path) -> None:
        self._db_path = Path(db_path)
        self._db_path.parent.mkdir(parents=True, exist_ok=True)
        self._initialize()

    @property
    def db_path(self) -> Path:
        return self._db_path

    def upsert_chunks(self, rows: list[VectorChunkRow]) -> None:
        if not rows:
            return
        node_ids = {row.node_id for row in rows}
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            for node_id in node_ids:
                self._delete_node_locked(connection, node_id)
            connection.executemany(
                """
                INSERT INTO index_chunks (
                    chunk_id, node_id, mount_id, source_ref, name, title, text
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        row.chunk_id,
                        row.node_id,
                        row.mount_id,
                        row.source_ref,
                        row.name,
                        row.title,
                        row.text,
                    )
                    for row in rows
                ],
            )
            connection.executemany(
                """
                INSERT INTO index_chunks_fts (chunk_id, title, text)
                VALUES (?, ?, ?)
                """,
                [(row.chunk_id, row.title, row.text) for row in rows],
            )

    def delete_by_node_id(self, node_id: str) -> None:
        with self._connect() as connection:
            connection.execute("BEGIN IMMEDIATE")
            self._delete_node_locked(connection, node_id)

    def count_chunks(self) -> int:
        with self._connect() as connection:
            return int(connection.execute("SELECT COUNT(*) FROM index_chunks").fetchone()[0])

    def search_fts(self, query: str, *, limit: int = 10, title_only: bool = False) -> list[VectorChunkRow]:
        if not query.strip():
            return []
        with self._connect() as connection:
            match_query = _normalize_fts_query(query)
            column = "title" if title_only else ""
            if column:
                rows = connection.execute(
                    f"""
                    SELECT c.chunk_id, c.node_id, c.mount_id, c.source_ref, c.name, c.title, c.text
                    FROM index_chunks_fts AS f
                    JOIN index_chunks AS c ON c.chunk_id = f.chunk_id
                    WHERE f.{column} MATCH ?
                    ORDER BY bm25(index_chunks_fts)
                    LIMIT ?
                    """,
                    (match_query, limit),
                ).fetchall()
            else:
                rows = connection.execute(
                    """
                    SELECT c.chunk_id, c.node_id, c.mount_id, c.source_ref, c.name, c.title, c.text
                    FROM index_chunks_fts AS f
                    JOIN index_chunks AS c ON c.chunk_id = f.chunk_id
                    WHERE index_chunks_fts MATCH ?
                    ORDER BY bm25(index_chunks_fts)
                    LIMIT ?
                    """,
                    (match_query, limit),
                ).fetchall()
        return [
            VectorChunkRow(
                chunk_id=str(row[0]),
                node_id=str(row[1]),
                mount_id=str(row[2]),
                source_ref=str(row[3]),
                name=str(row[4]),
                title=str(row[5]),
                text=str(row[6]),
                embedding=VectorRowEmbedding.from_iterable(()),
            )
            for row in rows
        ]

    def _initialize(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS index_chunks (
                    chunk_id TEXT PRIMARY KEY,
                    node_id TEXT NOT NULL,
                    mount_id TEXT NOT NULL,
                    source_ref TEXT NOT NULL,
                    name TEXT NOT NULL,
                    title TEXT NOT NULL,
                    text TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS index_chunks_fts
                USING fts5(chunk_id UNINDEXED, title, text)
                """
            )

    def _delete_node_locked(self, connection: sqlite3.Connection, node_id: str) -> None:
        chunk_rows = connection.execute(
            "SELECT chunk_id FROM index_chunks WHERE node_id = ?",
            (node_id,),
        ).fetchall()
        if not chunk_rows:
            return
        chunk_ids = [str(row[0]) for row in chunk_rows]
        connection.executemany(
            "DELETE FROM index_chunks_fts WHERE chunk_id = ?",
            [(chunk_id,) for chunk_id in chunk_ids],
        )
        connection.execute("DELETE FROM index_chunks WHERE node_id = ?", (node_id,))

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self._db_path, timeout=30)
        connection.execute("PRAGMA busy_timeout = 30000")
        return connection


def _normalize_fts_query(query: str) -> str:
    tokens = [token for token in query.strip().split() if token]
    if not tokens:
        return ""
    return " OR ".join(tokens)
