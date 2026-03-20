import pytest

from worker import __doc__
from worker import __main__ as worker_main
from worker.runtime import bootstrap


def test_worker_package_imports():
    assert __doc__ == "Know Disk Python worker package."


def test_worker_main_delegates_to_runtime_bootstrap(monkeypatch):
    calls: list[str] = []

    monkeypatch.setattr(bootstrap, "main", lambda: calls.append("bootstrap"))

    worker_main.main()

    assert calls == ["bootstrap"]


def test_worker_main_exits_quietly_on_keyboard_interrupt(monkeypatch):
    monkeypatch.setattr(bootstrap, "main", lambda: (_ for _ in ()).throw(KeyboardInterrupt()))

    with pytest.raises(SystemExit) as exc_info:
        worker_main.main()

    assert exc_info.value.code == 130
