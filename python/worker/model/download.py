from __future__ import annotations

from collections.abc import Callable, Iterable, Mapping
from pathlib import Path
from typing import Any, cast
from urllib.parse import urlsplit

ProgressCallback = Callable[[int, int], None]
DownloadFetch = Callable[[str, dict[str, str] | None], Any]


def download_file(
    url: str,
    destination: str | Path,
    fetch: DownloadFetch,
    on_progress: ProgressCallback | None = None,
    max_attempts: int = 3,
) -> Path:
    if max_attempts < 1:
        raise ValueError("max_attempts must be at least 1")
    attempt = 0
    while True:
        try:
            return _download_file_once(url, destination, fetch, on_progress=on_progress)
        except Exception as error:
            attempt += 1
            if attempt >= max_attempts or not _is_retryable_download_error(error):
                raise _annotate_download_error(url, error) from error


def _download_file_once(
    url: str,
    destination: str | Path,
    fetch: DownloadFetch,
    on_progress: ProgressCallback | None = None,
) -> Path:
    destination_path = Path(destination)
    part_path = destination_path.with_name(f"{destination_path.name}.part")
    destination_path.parent.mkdir(parents=True, exist_ok=True)

    resumed_bytes = _existing_part_size(part_path)
    headers = {"Range": f"bytes={resumed_bytes}-"} if resumed_bytes > 0 else None
    response = fetch(url, headers)
    status = _response_status(response)
    if status not in {200, 206}:
        raise ValueError(f"failed to download {url}: status {status}")

    supports_resume = resumed_bytes > 0 and status == 206
    if not supports_resume:
        resumed_bytes = 0
    else:
        content_range = _header_value(_response_headers(response), "content-range")
        if content_range is None:
            raise ValueError(f"failed to resume download for {url}: missing content-range")
        range_start, _range_end, _range_total = _parse_content_range(content_range)
        if range_start != resumed_bytes:
            raise ValueError(
                f"failed to resume download for {url}: expected range start {resumed_bytes}, got {range_start}"
            )

    total_bytes = _compute_total_bytes(response, resumed_bytes)
    if resumed_bytes > 0 and on_progress is not None:
        on_progress(resumed_bytes, total_bytes)

    mode = "ab" if resumed_bytes > 0 else "wb"
    written_bytes = resumed_bytes
    with part_path.open(mode) as handle:
        for chunk in _iter_body(response):
            if not chunk:
                continue
            handle.write(chunk)
            written_bytes += len(chunk)
            if on_progress is not None:
                on_progress(written_bytes, total_bytes)

    if total_bytes > 0 and written_bytes != total_bytes:
        raise ValueError(f"incomplete download for {url}: {written_bytes}/{total_bytes}")

    part_path.replace(destination_path)
    return destination_path


def _is_retryable_download_error(error: Exception) -> bool:
    if isinstance(error, (OSError, TimeoutError, EOFError)):
        return True
    if isinstance(error, ValueError):
        return "incomplete download" in str(error)
    return False


def _annotate_download_error(url: str, error: Exception) -> ValueError:
    parsed = urlsplit(url)
    endpoint = f"{parsed.scheme}://{parsed.netloc}" if parsed.scheme and parsed.netloc else ""
    details = [f"failed to download {url}"]
    if endpoint:
        details.append(f"endpoint={endpoint}")
    if parsed.netloc:
        details.append(f"host={parsed.netloc}")
    details.append(str(error))
    return ValueError(": ".join(details))


def _existing_part_size(part_path: Path) -> int:
    try:
        return part_path.stat().st_size
    except FileNotFoundError:
        return 0


def _response_status(response: Any) -> int:
    status = getattr(response, "status", None)
    if not isinstance(status, int):
        raise ValueError("download response is missing a numeric status")
    return status


def _compute_total_bytes(response: Any, resumed_bytes: int) -> int:
    headers = _response_headers(response)
    content_range = _header_value(headers, "content-range")
    if content_range:
        total = _parse_content_range_total(content_range)
        if total > 0:
            return total

    content_length = _header_value(headers, "content-length")
    if content_length is not None:
        try:
            length = int(content_length)
        except ValueError:
            length = 0
        if length > 0:
            return resumed_bytes + length

    return resumed_bytes


def _iter_body(response: Any) -> Iterable[bytes]:
    body = getattr(response, "body", None)
    if body is None:
        raise ValueError("download response is missing a body")
    if isinstance(body, (bytes, bytearray)):
        return [bytes(body)]
    return body


def _response_headers(response: Any) -> Mapping[str, str]:
    headers = getattr(response, "headers", None)
    if not isinstance(headers, Mapping):
        return {}
    return cast(Mapping[str, str], headers)


def _header_value(headers: Mapping[str, str], name: str) -> str | None:
    lowered = name.lower()
    for key, value in headers.items():
        if isinstance(key, str) and key.lower() == lowered and isinstance(value, str):
            return value
    return None


def _parse_content_range_total(value: str) -> int:
    # Expected format: bytes start-end/total
    try:
        _, total_text = value.rsplit("/", 1)
        total = int(total_text)
    except (ValueError, TypeError):
        return 0
    return total if total > 0 else 0


def _parse_content_range(value: str) -> tuple[int, int, int]:
    try:
        unit_and_range, total_text = value.split("/", 1)
        _unit, range_text = unit_and_range.split(" ", 1)
        start_text, end_text = range_text.split("-", 1)
        start = int(start_text)
        end = int(end_text)
        total = int(total_text)
    except (ValueError, TypeError):
        raise ValueError("download response has invalid content-range")
    if start < 0 or end < start or total <= 0:
        raise ValueError("download response has invalid content-range")
    if end >= total:
        raise ValueError("download response has invalid content-range")
    return start, end, total
