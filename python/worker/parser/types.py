from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Mapping
from typing import Literal, TypeAlias

ParserStatus: TypeAlias = Literal["ok", "skipped", "error"]


@dataclass(frozen=True, slots=True)
class ParserNode:
    node_id: str
    name: str
    source_ref: str
    provider_type: str = ""
    mount_id: str = ""
    kind: str = "file"

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ParserNode:
        return cls(
            node_id=str(value["nodeId"]),
            name=str(value["name"]),
            source_ref=str(value.get("sourceRef") or ""),
            provider_type=str(value.get("providerType") or ""),
            mount_id=str(value.get("mountId") or ""),
            kind=str(value.get("kind") or "file"),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        return {
            "nodeId": self.node_id,
            "name": self.name,
            "sourceRef": self.source_ref,
            "providerType": self.provider_type,
            "mountId": self.mount_id,
            "kind": self.kind,
        }


@dataclass(frozen=True, slots=True)
class ParserMount:
    synced_content_path: str = ""
    local_file_path: str = ""
    provider_type: str = ""

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ParserMount:
        return cls(
            synced_content_path=str(value.get("syncedContentPath") or ""),
            local_file_path=str(value.get("localFilePath") or ""),
            provider_type=str(value.get("providerType") or ""),
        )

    def to_legacy_dict(self) -> dict[str, object]:
        return {
            "syncedContentPath": self.synced_content_path,
            "localFilePath": self.local_file_path,
            "providerType": self.provider_type,
        }


@dataclass(frozen=True, slots=True)
class ParsedSource:
    node_id: str
    name: str
    path: str = ""

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ParsedSource:
        return cls(
            node_id=str(value["nodeId"]),
            name=str(value["name"]),
            path=str(value.get("path") or ""),
        )

    def to_legacy_dict(self, *, include_empty_path: bool = False) -> dict[str, object]:
        result: dict[str, object] = {
            "nodeId": self.node_id,
            "name": self.name,
        }
        if self.path or include_empty_path:
            result["path"] = self.path
        return result


@dataclass(frozen=True, slots=True)
class ParsedChunkError:
    code: str
    message: str

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ParsedChunkError:
        return cls(code=str(value["code"]), message=str(value["message"]))

    def to_legacy_dict(self) -> dict[str, object]:
        return {
            "code": self.code,
            "message": self.message,
        }


@dataclass(frozen=True, slots=True)
class ParsedChunk:
    status: ParserStatus
    chunk_index: int
    text: str
    title: str
    source: ParsedSource
    error: ParsedChunkError | None = None

    @classmethod
    def from_mapping(cls, value: Mapping[str, object]) -> ParsedChunk:
        status_value = value["status"]
        if not isinstance(status_value, str) or status_value not in {"ok", "skipped", "error"}:
            raise ValueError("invalid parsed chunk status")
        error_value = value.get("error")
        error = (
            ParsedChunkError.from_mapping(error_value)
            if isinstance(error_value, Mapping)
            else None
        )
        source_value = value.get("source")
        if not isinstance(source_value, Mapping):
            raise ValueError("parsed chunk source must be a mapping")
        return cls(
            status=status_value,
            chunk_index=int(value["chunkIndex"]),
            text=str(value["text"]),
            title=str(value["title"]),
            source=ParsedSource.from_mapping(source_value),
            error=error,
        )

    def with_source_path(self, path: str) -> ParsedChunk:
        return ParsedChunk(
            status=self.status,
            chunk_index=self.chunk_index,
            text=self.text,
            title=self.title,
            source=ParsedSource(
                node_id=self.source.node_id,
                name=self.source.name,
                path=path,
            ),
            error=self.error,
        )

    def to_legacy_dict(self, *, include_empty_source_path: bool = False) -> dict[str, object]:
        result: dict[str, object] = {
            "status": self.status,
            "chunkIndex": self.chunk_index,
            "text": self.text,
            "title": self.title,
            "source": self.source.to_legacy_dict(
                include_empty_path=include_empty_source_path
            ),
        }
        if self.error is not None:
            result["error"] = self.error.to_legacy_dict()
        return result


def coerce_parser_node(value: ParserNode | Mapping[str, object]) -> ParserNode:
    if isinstance(value, ParserNode):
        return value
    return ParserNode.from_mapping(value)


def coerce_parser_mount(value: ParserMount | Mapping[str, object]) -> ParserMount:
    if isinstance(value, ParserMount):
        return value
    return ParserMount.from_mapping(value)


def coerce_parsed_chunk(value: ParsedChunk | Mapping[str, object]) -> ParsedChunk:
    if isinstance(value, ParsedChunk):
        return value
    return ParsedChunk.from_mapping(value)
