from dataclasses import dataclass
from pathlib import Path

from worker.model_download import download_file


@dataclass
class FakeResponse:
    status: int
    headers: dict[str, str]
    body: list[bytes]


def test_download_writes_part_then_promotes_final_file(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    progress: list[tuple[int, int]] = []

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        return FakeResponse(
            status=200,
            headers={"content-length": "6"},
            body=[b"he", b"ll", b"o!"],
        )

    destination = tmp_path / "model.bin"

    download_file(
        "https://example.com/model.bin",
        destination,
        fetch,
        on_progress=lambda downloaded, total: progress.append((downloaded, total)),
    )

    assert destination.exists()
    assert destination.read_bytes() == b"hello!"
    assert not destination.with_name("model.bin.part").exists()
    assert calls == [("https://example.com/model.bin", None)]
    assert progress == [(2, 6), (4, 6), (6, 6)]


def test_download_resumes_from_existing_part_file(tmp_path: Path):
    calls: list[tuple[str, dict[str, str] | None]] = []
    progress: list[tuple[int, int]] = []
    destination = tmp_path / "model.bin"
    part_path = tmp_path / "model.bin.part"
    part_path.write_bytes(b"test")

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        calls.append((url, headers))
        assert headers == {"Range": "bytes=4-"}
        return FakeResponse(
            status=206,
            headers={
                "content-length": "4",
                "content-range": "bytes 4-7/8",
            },
            body=[b"da", b"ta"],
        )

    download_file(
        "https://example.com/model.bin",
        destination,
        fetch,
        on_progress=lambda downloaded, total: progress.append((downloaded, total)),
    )

    assert destination.exists()
    assert destination.read_bytes() == b"testdata"
    assert not part_path.exists()
    assert calls == [("https://example.com/model.bin", {"Range": "bytes=4-"})]
    assert progress == [(4, 8), (6, 8), (8, 8)]


def test_download_reports_aggregate_progress_across_chunks(tmp_path: Path):
    progress: list[tuple[int, int]] = []

    def fetch(url: str, headers: dict[str, str] | None = None) -> FakeResponse:
        _ = (url, headers)
        return FakeResponse(
            status=200,
            headers={"content-length": "5"},
            body=[b"a", b"bc", b"de"],
        )

    download_file(
        "https://example.com/model.bin",
        tmp_path / "model.bin",
        fetch,
        on_progress=lambda downloaded, total: progress.append((downloaded, total)),
    )

    assert progress == [(1, 5), (3, 5), (5, 5)]
