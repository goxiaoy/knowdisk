# Python Sidecar Binary Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace bundled venv-based Python packaging with a standalone sidecar executable that the packaged app can spawn reliably.

**Architecture:** Keep the existing stdio worker protocol, but swap packaged runtime launch from `python -m worker` to a platform-specific sidecar binary under app resources. Development mode stays on `uv run --project python python -m worker`, while stable packaged builds use the bundled executable.

**Tech Stack:** Electrobun, Bun, TypeScript, Python, PyInstaller, macOS app bundle resources

---

### Task 1: Add a failing packaging test for staged sidecar assets

**Files:**
- Modify: `scripts/prepare-python-runtime.test.ts`
- Reference: `scripts/prepare-python-runtime.ts`

**Step 1: Write the failing test**

Add a test that stages a fake sidecar build output and expects the prepare script to copy:

- the sidecar executable into `vendor/python-sidecar/mac/knowdisk-python-worker`
- no `vendor/python-runtime` directory

**Step 2: Run test to verify it fails**

Run: `bun test scripts/prepare-python-runtime.test.ts`
Expected: FAIL because the current prepare script still stages `python-runtime`.

**Step 3: Write minimal implementation**

Refactor the prepare script tests so they target a new sidecar-staging contract instead of the old venv runtime contract.

**Step 4: Run test to verify it passes**

Run: `bun test scripts/prepare-python-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/prepare-python-runtime.test.ts
git commit -m "test(build): cover staged python sidecar assets"
```

### Task 2: Replace venv staging with sidecar staging

**Files:**
- Modify: `scripts/prepare-python-runtime.ts`
- Create: `scripts/build-python-sidecar.ts`
- Reference: `python/`

**Step 1: Write the failing test**

Add a test for the build helper that expects:

- sidecar executable path returned for macOS
- worker entrypoint included in the built binary, not staged as raw Python package files

**Step 2: Run test to verify it fails**

Run: `bun test scripts/prepare-python-runtime.test.ts`
Expected: FAIL because no sidecar build helper exists yet.

**Step 3: Write minimal implementation**

Implement a build helper that:

- invokes `PyInstaller` against the Python worker entrypoint
- writes platform-specific output under `vendor/python-sidecar/<platform>/`
- asserts the expected executable exists

Update the prepare script to call that helper and stop copying `python/.venv`.

**Step 4: Run test to verify it passes**

Run: `bun test scripts/prepare-python-runtime.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/prepare-python-runtime.ts scripts/build-python-sidecar.ts scripts/prepare-python-runtime.test.ts
git commit -m "feat(build): stage standalone python sidecar"
```

### Task 3: Update Electrobun copy config to bundle the sidecar

**Files:**
- Modify: `electrobun.config.ts`
- Modify: `electrobun.config.test.ts`

**Step 1: Write the failing test**

Add a config test that expects staged `vendor/python-sidecar` assets to be copied into:

- `python-sidecar`

and expects the old `python-runtime` copy entry to be absent.

**Step 2: Run test to verify it fails**

Run: `bun test electrobun.config.test.ts`
Expected: FAIL because the config still copies `vendor/python-runtime`.

**Step 3: Write minimal implementation**

Update the Electrobun build copy config to:

- include `vendor/python-sidecar`
- remove `vendor/python-runtime`
- keep existing worker-independent assets intact

**Step 4: Run test to verify it passes**

Run: `bun test electrobun.config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add electrobun.config.ts electrobun.config.test.ts
git commit -m "feat(build): bundle packaged python sidecar assets"
```

### Task 4: Switch packaged runtime command resolution to the sidecar binary

**Files:**
- Modify: `src/bun/python/command.ts`
- Modify: `src/bun/python/command.test.ts`

**Step 1: Write the failing test**

Add command-resolution expectations for non-dev packaged builds:

- macOS packaged mode returns `Contents/Resources/python-sidecar/mac/knowdisk-python-worker`
- dev channel still returns `uv run --project ... python -m worker`

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python/command.test.ts`
Expected: FAIL because packaged mode still points at `python-runtime`.

**Step 3: Write minimal implementation**

Update command resolution to:

- return the packaged sidecar executable path for non-dev packaged channels
- keep development mode untouched

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python/command.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/python/command.ts src/bun/python/command.test.ts
git commit -m "feat(runtime): launch packaged python sidecar binary"
```

### Task 5: Verify runtime startup with the packaged sidecar

**Files:**
- Modify: `src/bun/python/integration.test.ts`
- Optional: `src/bun/index.ts`

**Step 1: Write the failing test**

Add or extend an integration test to prove packaged runtime launch does not require:

- `python-runtime/bin/python`
- `worker/__main__.py`

Use a fake packaged command or fixture that mirrors the sidecar launch path.

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python/integration.test.ts`
Expected: FAIL because packaged launch assumptions still reference the old runtime.

**Step 3: Write minimal implementation**

Adjust any remaining startup wiring so the packaged transport treats the sidecar as the executable itself.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python/integration.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/bun/python/integration.test.ts src/bun/index.ts
git commit -m "test(runtime): cover packaged python sidecar startup"
```

### Task 6: Rebuild and validate the macOS stable app

**Files:**
- No code changes required unless validation reveals a gap

**Step 1: Build the stable app**

Run:

```bash
bun run build:prod
```

Expected: build completes and stages the packaged sidecar under `build/stable-macos-arm64/Know Disk.app/Contents/Resources/python-sidecar/mac/`.

**Step 2: Launch the packaged app directly**

Run:

```bash
build/stable-macos-arm64/Know\ Disk.app/Contents/MacOS/launcher
```

Expected:

- no `libpython` load failure
- no `No module named worker`
- Python worker logs `python worker started`
- model status progresses beyond fallback `available: false`

**Step 3: Run focused regression tests**

Run:

```bash
bun test src/bun/python/command.test.ts src/bun/runtime-mode.test.ts src/bun/python/integration.test.ts electrobun.config.test.ts scripts/prepare-python-runtime.test.ts
```

Expected: PASS

**Step 4: Commit**

```bash
git add .
git commit -m "feat(packaging): ship standalone python sidecar"
```

### Task 7: Remove obsolete bundled venv packaging

**Files:**
- Modify: `package.json`
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Optional cleanup: old runtime-specific tests or docs

**Step 1: Write the failing doc/test update**

Update references that still describe the bundled venv runtime so they no longer point engineers at the deprecated packaging path.

**Step 2: Run relevant checks**

Run:

```bash
bun test electrobun.config.test.ts scripts/prepare-python-runtime.test.ts
```

Expected: PASS with no remaining references to `vendor/python-runtime` as the packaged runtime strategy.

**Step 3: Write minimal implementation**

Remove obsolete script assumptions and update build documentation to describe the sidecar build pipeline.

**Step 4: Verify**

Run:

```bash
rg -n "python-runtime" README.md README.zh-CN.md package.json scripts src electrobun.config.ts
```

Expected: only intentional references remain.

**Step 5: Commit**

```bash
git add package.json README.md README.zh-CN.md
git commit -m "docs(build): document python sidecar packaging"
```
