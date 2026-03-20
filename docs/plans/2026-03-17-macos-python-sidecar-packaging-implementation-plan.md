# macOS Python Sidecar Packaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Package the macOS app with a bundled Python sidecar runtime so the built app can start the worker without `uv`, `process.cwd()`, or repo-local Python sources.

**Architecture:** Introduce a worker command resolver with separate development and packaged-macOS branches. Add a build preparation script that stages `python-runtime` and `python-worker` assets under `vendor/`, then have Electrobun copy those staged assets into app resources and update the runtime to resolve worker paths from packaged resources.

**Tech Stack:** Bun, TypeScript, Bun test, Electrobun build config, macOS app resources, Python worker

---

### Task 1: Add worker command resolution for dev vs packaged macOS

**Files:**
- Create: `src/bun/python-worker-command.ts`
- Create: `src/bun/python-worker-command.test.ts`
- Modify: `src/bun/app.container.ts`

**Step 1: Write the failing test**

Add `src/bun/python-worker-command.test.ts` covering:

- development mode returns `["uv", "run", "--project", "<repo>/python", "python", "-m", "worker"]`
- packaged macOS mode returns `[<resources>/python-runtime/bin/python, <resources>/python-worker/worker/__main__.py]`

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python-worker-command.test.ts`
Expected: FAIL because the resolver module does not exist.

**Step 3: Write minimal implementation**

Implement `src/bun/python-worker-command.ts` with:

- `resolvePythonWorkerCommand(...)`
- explicit inputs for:
  - `mode: "development" | "packaged-macos"`
  - `repoPythonProjectDir`
  - `resourcesDir`

Update `src/bun/app.container.ts` to use this resolver instead of hardcoding `uv`.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python-worker-command.test.ts src/bun/app.container.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/python-worker-command.ts src/bun/python-worker-command.test.ts src/bun/app.container.ts src/bun/app.container.test.ts
git commit -m "feat: add packaged python worker command resolver"
```

### Task 2: Add build-time Python runtime staging script

**Files:**
- Create: `scripts/prepare-python-runtime.ts`
- Create: `scripts/prepare-python-runtime.test.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

Add `scripts/prepare-python-runtime.test.ts` covering:

- staging copies worker files into `vendor/python-worker`
- staging copies a provided runtime directory into `vendor/python-runtime`
- staging fails with a clear error when the expected interpreter or worker entrypoint is missing

**Step 2: Run test to verify it fails**

Run: `bun test scripts/prepare-python-runtime.test.ts`
Expected: FAIL because the script does not exist.

**Step 3: Write minimal implementation**

Implement `scripts/prepare-python-runtime.ts` with:

- input env/config for source runtime location
- copy logic for:
  - `python/worker`
  - bundled runtime directory
- validation for:
  - `vendor/python-runtime/bin/python`
  - `vendor/python-worker/worker/__main__.py`

Update `package.json` with a build helper script such as:

- `prepare:python-runtime`

**Step 4: Run test to verify it passes**

Run: `bun test scripts/prepare-python-runtime.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add scripts/prepare-python-runtime.ts scripts/prepare-python-runtime.test.ts package.json
git commit -m "feat: add python runtime staging script"
```

### Task 3: Copy bundled Python assets into the packaged app

**Files:**
- Modify: `electrobun.config.ts`
- Create: `electrobun.config.test.ts`

**Step 1: Write the failing test**

Add `electrobun.config.test.ts` covering:

- `vendor/python-runtime` is copied into app resources
- `vendor/python-worker` is copied into app resources

**Step 2: Run test to verify it fails**

Run: `bun test electrobun.config.test.ts`
Expected: FAIL because the config does not yet copy the Python assets.

**Step 3: Write minimal implementation**

Update `electrobun.config.ts` copy rules to include:

- `vendor/python-runtime`
- `vendor/python-worker`

Keep the existing resource copies unchanged.

**Step 4: Run test to verify it passes**

Run: `bun test electrobun.config.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add electrobun.config.ts electrobun.config.test.ts
git commit -m "build: bundle python runtime resources"
```

### Task 4: Wire packaged-mode worker startup into the Bun runtime

**Files:**
- Modify: `src/bun/index.ts`
- Modify: `src/bun/python-worker.integration.test.ts`

**Step 1: Write the failing test**

Extend `src/bun/python-worker.integration.test.ts` with one resolver-focused case covering:

- packaged-mode command selection uses bundled interpreter path inputs
- development mode integration remains unchanged

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/python-worker.integration.test.ts src/bun/python-worker-command.test.ts`
Expected: FAIL because `index.ts` still assumes repo-local Python paths.

**Step 3: Write minimal implementation**

Update the Bun startup path so production uses the new packaged-macOS resolver inputs instead of `process.cwd()` assumptions.

Keep the dev integration test using the current repo-local worker.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/python-worker.integration.test.ts src/bun/python-worker-command.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/bun/python-worker.integration.test.ts src/bun/python-worker-command.test.ts
git commit -m "feat: start bundled python worker in packaged macos builds"
```

### Task 5: Add build verification and developer docs

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`

**Step 1: Write the failing checklist**

Document these required checks in the task itself:

- how to provide the bundled Python runtime source directory
- how to stage Python assets
- how to run the macOS build
- how to verify the packaged app contains Python resources

**Step 2: Run verification commands**

Run:

```bash
bun test src/bun/python-worker-command.test.ts src/bun/python-worker.integration.test.ts src/bun/app.container.test.ts src/bun/python-worker-runtime.test.ts src/bun/python-worker-app-runtime.test.ts src/bun/python-worker-indexing-hooks.test.ts src/bun/python-worker-node-context.test.ts src/bun/python-worker-status.test.ts
bun run python:test
```

Expected:

- Bun target tests PASS
- Python tests PASS

**Step 3: Write minimal implementation**

Update `README.md` and `README.zh-CN.md` with:

- dev worker startup
- macOS packaged worker startup
- runtime staging requirements
- build verification commands

Keep the docs aligned with the actual implemented commands.

**Step 4: Run verification again**

Run:

```bash
bun test src/bun/python-worker-command.test.ts src/bun/python-worker.integration.test.ts src/bun/app.container.test.ts src/bun/python-worker-runtime.test.ts src/bun/python-worker-app-runtime.test.ts src/bun/python-worker-indexing-hooks.test.ts src/bun/python-worker-node-context.test.ts src/bun/python-worker-status.test.ts
bun run python:test
```

Expected:

- Bun target tests PASS
- Python tests PASS

**Step 5: Commit**

```bash
git add README.md README.zh-CN.md
git commit -m "docs: add macos python packaging workflow"
```
