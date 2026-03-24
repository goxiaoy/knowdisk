from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from pathlib import Path
from time import perf_counter

from worker.parser.types import ParsedChunk, ParsedChunkError, ParsedSource, ParserNode, coerce_parser_node
from worker.runtime.logging import WorkerLogger, get_process_rss_mb

ImageAnalyzer = Callable[[object | None, str], object]


def parse_image_document(
    node: ParserNode | Mapping[str, object],
    source_path: str,
    *,
    ocr_runtime: object | None = None,
    caption_runtime: object | None = None,
    ocr_analyze: ImageAnalyzer | None = None,
    caption_analyze: ImageAnalyzer | None = None,
    logger: WorkerLogger | None = None,
) -> list[dict[str, object]]:
    parsed_node = coerce_parser_node(node)
    title = Path(parsed_node.name).stem
    path = Path(source_path)
    size_bytes = path.stat().st_size if path.exists() else 0
    started_at = perf_counter()

    if logger is not None:
        logger.log(
            "debug",
            "image parse started",
            name=parsed_node.name,
            sourcePath=source_path,
            sizeBytes=size_bytes,
            rssMb=get_process_rss_mb(),
        )

    try:
        ocr_result = _run_ocr(
            source_path,
            runtime=ocr_runtime,
            analyzer=ocr_analyze or _missing_ocr_analyze,
        )
    except Exception as error:
        return _error_chunk(
            node=parsed_node,
            source_path=source_path,
            code="IMAGE_OCR_ERROR",
            message=str(error),
            title=title,
            logger=logger,
            started_at=started_at,
            size_bytes=size_bytes,
        )

    try:
        caption_result = _run_caption(
            source_path,
            runtime=caption_runtime,
            analyzer=caption_analyze or _missing_caption_analyze,
        )
    except Exception as error:
        return _error_chunk(
            node=parsed_node,
            source_path=source_path,
            code="IMAGE_CAPTION_ERROR",
            message=str(error),
            title=title,
            logger=logger,
            started_at=started_at,
            size_bytes=size_bytes,
        )

    ocr_text, page, regions = _normalize_ocr_result(ocr_result)
    caption_text = _normalize_caption_result(caption_result)
    text = _compose_multimodal_text(
        source_path=source_path,
        caption_text=caption_text,
        ocr_text=ocr_text,
        page=page,
        regions=regions,
    )

    if logger is not None:
        logger.log(
            "debug",
            "image parse finished",
            name=parsed_node.name,
            sourcePath=source_path,
            sizeBytes=size_bytes,
            durationMs=int((perf_counter() - started_at) * 1000),
            rssMb=get_process_rss_mb(),
            captionBytes=len(caption_text.encode("utf-8")),
            ocrBytes=len(ocr_text.encode("utf-8")),
            regionCount=len(regions),
        )

    return [
        ParsedChunk(
            status="ok",
            chunk_index=0,
            text=text,
            title=title,
            source=ParsedSource(
                node_id=parsed_node.node_id,
                name=parsed_node.name,
                path=source_path,
            ),
        ).to_legacy_dict()
    ]


def _run_ocr(
    source_path: str,
    *,
    runtime: object | None,
    analyzer: ImageAnalyzer,
) -> object:
    return analyzer(runtime, source_path)


def _run_caption(
    source_path: str,
    *,
    runtime: object | None,
    analyzer: ImageAnalyzer,
) -> object:
    return analyzer(runtime, source_path)


def _missing_ocr_analyze(runtime: object | None, source_path: str) -> object:
    _ = runtime, source_path
    raise RuntimeError("ocr image runtime is not configured")


def _missing_caption_analyze(runtime: object | None, source_path: str) -> object:
    _ = runtime, source_path
    raise RuntimeError("caption image runtime is not configured")


def _normalize_ocr_result(value: object) -> tuple[str, str, list[dict[str, object]]]:
    if isinstance(value, Mapping):
        ocr_text = str(value.get("text") or value.get("ocrText") or "")
        page_value = value.get("page")
        page = "" if page_value is None else str(page_value)
        regions_value = value.get("regions")
        regions = []
        if isinstance(regions_value, list):
            for region in regions_value:
                if isinstance(region, Mapping):
                    regions.append(
                        {
                            "id": str(region.get("id") or region.get("regionId") or ""),
                            "bbox": region.get("bbox"),
                            "text": str(region.get("text") or region.get("ocrText") or ""),
                        }
                    )
        return ocr_text, page, regions
    return str(value), "", []


def _normalize_caption_result(value: object) -> str:
    if isinstance(value, Mapping):
        return str(value.get("caption") or value.get("text") or "")
    return str(value)


def _compose_multimodal_text(
    *,
    source_path: str,
    caption_text: str,
    ocr_text: str,
    page: str,
    regions: list[dict[str, object]],
) -> str:
    metadata_lines = [
        f"path={source_path}",
        f"page={page or 'n/a'}",
        f"regions={len(regions)}",
    ]
    for index, region in enumerate(regions):
        region_parts = [f"region[{index}]"]
        region_id = str(region.get("id") or "")
        if region_id:
            region_parts.append(f"id={region_id}")
        bbox = region.get("bbox")
        if bbox is not None:
            region_parts.append(f"bbox={_format_bbox(bbox)}")
        region_text = str(region.get("text") or "")
        if region_text:
            region_parts.append(f"text={region_text}")
        metadata_lines.append(" ".join(region_parts))

    return "\n\n".join(
        [
            "Image caption:\n" + caption_text,
            "Image OCR:\n" + ocr_text,
            "Image metadata:\n" + "\n".join(metadata_lines),
        ]
    ).strip()


def _format_bbox(value: object) -> str:
    if isinstance(value, (list, tuple)):
        return "[" + ", ".join(str(item) for item in value) + "]"
    return json.dumps(value, ensure_ascii=False)


def _error_chunk(
    *,
    node: ParserNode,
    source_path: str,
    code: str,
    message: str,
    title: str,
    logger: WorkerLogger | None,
    started_at: float,
    size_bytes: int,
) -> list[dict[str, object]]:
    if logger is not None:
        logger.log(
            "error",
            "image parse failed",
            name=node.name,
            sourcePath=source_path,
            sizeBytes=size_bytes,
            durationMs=int((perf_counter() - started_at) * 1000),
            rssMb=get_process_rss_mb(),
            error=message,
            errorCode=code,
        )
    return [
        ParsedChunk(
            status="error",
            chunk_index=0,
            text="",
            title=title,
            source=ParsedSource(
                node_id=node.node_id,
                name=node.name,
                path=source_path,
            ),
            error=ParsedChunkError(code=code, message=message),
        ).to_legacy_dict()
    ]
