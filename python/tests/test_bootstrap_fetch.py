from worker.runtime import bootstrap


class FakeUrlopenResponse:
    def __init__(self, chunks: list[bytes]) -> None:
        self.status = 200
        self.headers = {"content-length": str(sum(len(chunk) for chunk in chunks))}
        self._chunks = chunks
        self.iteration_count = 0
        self.closed = False

    def __iter__(self):
        for chunk in self._chunks:
            self.iteration_count += 1
            yield chunk

    def close(self) -> None:
        self.closed = True

    def getcode(self) -> int:
        return self.status


def test_fetch_model_http_returns_streaming_body_without_eager_iteration(monkeypatch):
    response = FakeUrlopenResponse([b"ab", b"cd", b"ef"])

    monkeypatch.setattr(bootstrap, "urlopen", lambda request: response)

    fetch_response = bootstrap.fetch_model_http("https://example.com/model.bin")

    assert response.iteration_count == 0
    assert b"".join(fetch_response.body) == b"abcdef"
    assert response.iteration_count == 3
    assert response.closed is True


def test_fetch_model_http_sets_non_default_user_agent(monkeypatch):
    captured_headers: dict[str, str] = {}
    response = FakeUrlopenResponse([b"ok"])

    def fake_urlopen(request):
        captured_headers.update(dict(request.header_items()))
        return response

    monkeypatch.setattr(bootstrap, "urlopen", fake_urlopen)

    bootstrap.fetch_model_http("https://example.com/model.bin")

    user_agent = captured_headers.get("User-agent") or captured_headers.get("User-Agent")
    assert isinstance(user_agent, str)
    assert "Python-urllib" not in user_agent
