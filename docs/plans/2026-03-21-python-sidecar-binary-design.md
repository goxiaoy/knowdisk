# Python Sidecar Binary Packaging Design

**Problem**

The current macOS packaged app copies `python/.venv` into the bundle and spawns `python -m worker`. That is not a stable distribution model:

- the venv interpreter is a symlink into the local `uv` Python install
- the packaged interpreter depends on `libpython3.12.dylib` outside the bundle
- the bundle inherits venv-specific assumptions like `pyvenv.cfg` and external runtime layout
- users can end up with `model unavailable` because the worker crashes before startup completes

**Decision**

Replace the bundled venv runtime with a platform-specific standalone Python sidecar binary.

The packaged app should ship one executable per platform:

```text
Contents/Resources/python-sidecar/
  mac/knowdisk-python-worker
  linux/knowdisk-python-worker
  win/knowdisk-python-worker.exe
```

The Bun main process will spawn that sidecar directly instead of spawning a bundled Python interpreter plus `worker/__main__.py`.

**Recommended Build Strategy**

Use `PyInstaller` to build the worker into a standalone executable.

Why `PyInstaller` first:

- fastest path to a self-contained worker
- avoids venv symlink and `libpython` packaging issues
- mature enough for macOS, Windows, and Linux sidecars
- lets the current worker protocol stay unchanged

`Nuitka` remains a future option if startup time or binary size becomes a problem, but it adds more build complexity than needed for the first stable packaging pass.

**Architecture**

The app becomes a two-part packaged system:

1. Electrobun app bundle for UI and Bun main process
2. Python sidecar executable for indexing, parsing, vector search, and model management

The communication protocol does not need to change. The existing stdio JSON RPC transport remains the contract between Bun and the Python worker.

That means the migration is mostly packaging and process-launching work, not application-level behavior work.

**Runtime Flow**

1. Build step creates a standalone sidecar binary from the Python worker entrypoint.
2. Electrobun copies the sidecar into `Resources/python-sidecar/<platform>/`.
3. At runtime, Bun resolves the packaged sidecar path from the current platform and release channel.
4. Bun spawns the sidecar executable directly.
5. The existing `start`, `get_status_snapshot`, `index_node`, `delete_node`, and `search` requests continue unchanged over stdio.

**Repository Changes**

Add a dedicated build pipeline for the sidecar:

- a script that invokes `PyInstaller`
- a staging directory under `vendor/python-sidecar`
- Electrobun copy rules for sidecar assets
- platform-aware sidecar command resolution in Bun

The old `vendor/python-runtime` packaging path should be removed once the binary sidecar path is working.

**Path Conventions**

Development:

- keep using the existing `uv run --project python python -m worker` path for `channel === "dev"`

Packaged:

- spawn the bundled sidecar binary for non-dev channels

This preserves local iteration speed while making packaged apps self-contained.

**Error Handling**

If the sidecar binary is missing or fails to start:

- log the executable path and process error from Bun
- reset model/index/vector status stores to unavailable
- surface a startup error in packaged app logs

Do not silently fall back from packaged mode to repo-local Python. That would hide packaging regressions and make the app non-portable.

**Testing Strategy**

Focus tests on the seams that can regress:

- sidecar build script creates expected staged files
- Electrobun config copies staged sidecar files
- Bun command resolution chooses dev Python in `dev` channel and packaged sidecar in non-dev channels
- packaged app launch no longer depends on `python-runtime/bin/python`

Manual verification should include:

- build stable mac app
- launch bundled app directly from `build/stable-macos-arm64`
- confirm Python worker starts without `libpython` or `No module named worker` failures
- confirm model status reaches a non-fallback state

**Migration Plan**

Phase 1:

- add sidecar build output and packaged runtime resolution
- keep dev mode on `uv run`

Phase 2:

- remove old bundled venv runtime copy from Electrobun packaging
- delete obsolete runtime path tests and scripts that only exist for the venv bundle

**Open Constraints**

- PyInstaller must include the worker package and any runtime data files the worker needs
- macOS signing/notarization may need to include the sidecar binary explicitly later
- Windows and Linux should share the same structure, but the first validation target should be macOS because that is where packaging is currently broken
