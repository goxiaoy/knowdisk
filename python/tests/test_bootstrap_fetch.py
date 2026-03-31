from requests import RequestException

from worker.runtime import bootstrap


class FakeRequestsResponse:
    def __init__(self, chunks: list[bytes], *, status_code: int = 200) -> None:
        self.status_code = status_code
        self.headers = {"content-length": str(sum(len(chunk) for chunk in chunks))}
        self._chunks = chunks
        self.iteration_count = 0
        self.closed = False

    def iter_content(self, chunk_size: int = 8192):
        _ = chunk_size
        for chunk in self._chunks:
            self.iteration_count += 1
            yield chunk

    def close(self) -> None:
        self.closed = True

    def raise_for_status(self) -> None:
        if self.status_code >= 400:
            raise RequestException(f"status={self.status_code}")


def test_fetch_model_http_returns_streaming_body_without_eager_iteration(monkeypatch):
    response = FakeRequestsResponse([b"ab", b"cd", b"ef"])

    monkeypatch.setattr(bootstrap.requests, "get", lambda *args, **kwargs: response)

    fetch_response = bootstrap.fetch_model_http("https://example.com/model.bin")

    assert response.iteration_count == 0
    assert b"".join(fetch_response.body) == b"abcdef"
    assert response.iteration_count == 3
    assert response.closed is True


def test_fetch_model_http_sets_non_default_user_agent(monkeypatch):
    captured_headers: dict[str, str] = {}
    response = FakeRequestsResponse([b"ok"])

    def fake_get(url, *, headers, stream, timeout):
        _ = (url, stream, timeout)
        captured_headers.update(headers)
        return response

    monkeypatch.setattr(bootstrap.requests, "get", fake_get)

    bootstrap.fetch_model_http("https://example.com/model.bin")

    user_agent = captured_headers.get("User-Agent")
    assert isinstance(user_agent, str)
    assert "Python-urllib" not in user_agent


def test_fetch_model_http_retries_transient_request_errors(monkeypatch):
    attempts = 0
    response = FakeRequestsResponse([b"ok"])

    def fake_get(url, *, headers, stream, timeout):
        nonlocal attempts
        _ = (url, headers, stream, timeout)
        attempts += 1
        if attempts < 2:
            raise RequestException("transient eof")
        return response

    monkeypatch.setattr(bootstrap.requests, "get", fake_get)

    fetch_response = bootstrap.fetch_model_http("https://example.com/model.bin")

    assert attempts == 2
    assert b"".join(fetch_response.body) == b"ok"


def test_fetch_model_http_allows_several_transient_failures_before_success(monkeypatch):
    attempts = 0
    response = FakeRequestsResponse([b"ok"])

    def fake_get(url, *, headers, stream, timeout):
        nonlocal attempts
        _ = (url, headers, stream, timeout)
        attempts += 1
        if attempts < 5:
            raise RequestException("transient eof")
        return response

    monkeypatch.setattr(bootstrap.requests, "get", fake_get)
    monkeypatch.setattr(bootstrap.time, "sleep", lambda seconds: None)

    fetch_response = bootstrap.fetch_model_http("https://example.com/model.bin")

    assert attempts == 5
    assert b"".join(fetch_response.body) == b"ok"
