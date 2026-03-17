from worker.server import create_server


def test_start_returns_handshake_and_emits_health_event():
    emitted: list[dict] = []
    server = create_server(event_sink=emitted.append)

    response = server.handle_request({"id": "req-1", "method": "start", "params": {}})

    assert response == {
        "id": "req-1",
        "result": {
            "ok": True,
            "worker": "knowdisk-python-worker",
            "version": "0.1.0",
        },
    }
    assert emitted == [
        {
            "type": "worker_health_changed",
            "payload": {
                "ready": True,
            },
        }
    ]


def test_shutdown_returns_ok_and_marks_server_stopped():
    server = create_server(event_sink=lambda event: None)

    response = server.handle_request({"id": "req-2", "method": "shutdown", "params": {}})

    assert response == {"id": "req-2", "result": {"ok": True}}
    assert server.is_running is False


def test_unknown_method_returns_error_response():
    server = create_server(event_sink=lambda event: None)

    response = server.handle_request({"id": "req-3", "method": "missing", "params": {}})

    assert response == {
        "id": "req-3",
        "error": {
            "code": "METHOD_NOT_FOUND",
            "message": "Unknown method: missing",
        },
    }
