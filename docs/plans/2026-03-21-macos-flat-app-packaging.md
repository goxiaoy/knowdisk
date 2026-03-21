# macOS Flat App Packaging Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the current macOS self-extractor release output with conventional flat `.app` and `.dmg` artifacts.

**Architecture:** Keep Electrobun responsible for building the app bundle and bundled resources, but replace the final stable release packaging layer with a custom script that emits a flat `.app.zip` and a standard `.dmg`. The runtime and Python sidecar stay unchanged.

**Tech Stack:** Bun, TypeScript, Electrobun, macOS packaging tools, shell utilities

---

### Task 1: Add failing tests for flat macOS packaging outputs

**Files:**
- Create: `scripts/package-macos-flat-app.test.ts`
- Reference: `scripts/`

**Step 1: Write the failing test**

Add tests covering:

- packaging fails if the source `.app` does not exist
- packaging script creates expected output paths for:
  - `.app.zip`
  - `.dmg`

Stub the actual shell packaging commands so the test only asserts orchestration and file-path behavior.

**Step 2: Run test to verify it fails**

Run: `bun test scripts/package-macos-flat-app.test.ts`
Expected: FAIL because the packaging script does not exist.

**Step 3: Write minimal implementation**

Create the packaging script surface with the tested API shape, but only enough implementation to satisfy the tests.

**Step 4: Run test to verify it passes**

Run: `bun test scripts/package-macos-flat-app.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/package-macos-flat-app.test.ts scripts/package-macos-flat-app.ts
git commit -m "test(packaging): cover flat macos artifact generation"
```

### Task 2: Implement the flat macOS packaging script

**Files:**
- Create: `scripts/package-macos-flat-app.ts`
- Test: `scripts/package-macos-flat-app.test.ts`

**Step 1: Write the failing test**

Extend the tests to require the script to:

- recreate `artifacts/`
- emit `.app.zip`
- emit `.dmg`
- surface command failures clearly

**Step 2: Run test to verify it fails**

Run: `bun test scripts/package-macos-flat-app.test.ts`
Expected: FAIL because the script does not yet perform the packaging steps.

**Step 3: Write minimal implementation**

Implement the script to:

- validate source app exists
- create a temp staging directory
- zip the `.app`
- invoke the macOS dmg creation command
- place outputs in `artifacts/`

**Step 4: Run test to verify it passes**

Run: `bun test scripts/package-macos-flat-app.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add scripts/package-macos-flat-app.ts scripts/package-macos-flat-app.test.ts
git commit -m "feat(packaging): add flat macos artifact packager"
```

### Task 3: Wire the production build command to flat packaging

**Files:**
- Modify: `package.json`
- Optional: `README.md`
- Optional: `README.zh-CN.md`

**Step 1: Write the failing test**

If there is no script-level test for the build command, add one lightweight assertion in an existing packaging test or use a focused grep verification step in this task.

The new expected contract is:

- `build:prod` ends by calling the flat app packaging script
- release artifacts no longer depend on self-extractor outputs

**Step 2: Run test or verification to confirm current behavior is wrong**

Run:

```bash
node -e "const pkg=require('./package.json'); console.log(pkg.scripts['build:prod'])"
```

Expected: current script does not yet invoke the flat packaging script.

**Step 3: Write minimal implementation**

Update `build:prod` so it:

- builds the app bundle
- then invokes the flat macOS packaging step

**Step 4: Verify**

Run:

```bash
node -e "const pkg=require('./package.json'); console.log(pkg.scripts['build:prod'])"
```

Expected: script includes the new packaging command.

**Step 5: Commit**

```bash
git add package.json README.md README.zh-CN.md
git commit -m "build: switch mac release output to flat app packaging"
```

### Task 4: Validate produced artifacts and app launch

**Files:**
- No code changes required unless validation reveals a gap

**Step 1: Build**

Run:

```bash
bun run build:prod
```

Expected:

- `artifacts/stable-macos-arm64-KnowDisk.app.zip`
- `artifacts/stable-macos-arm64-KnowDisk.dmg`

**Step 2: Verify app bundle launch**

Run:

```bash
build/stable-macos-arm64/Know\ Disk.app/Contents/MacOS/launcher
```

Expected:

- no self-extractor prelude
- renderer loads
- Python worker starts

**Step 3: Verify packaged dmg install path**

Mount the `.dmg`, copy the `.app`, and launch it.

Expected:

- app opens directly
- no `Electrobun self-extractor v1.3 starting...`

**Step 4: Run focused tests**

Run:

```bash
bun test scripts/package-macos-flat-app.test.ts scripts/prepare-python-runtime.test.ts electrobun.config.test.ts src/bun/python/command.test.ts src/bun/runtime-mode.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add .
git commit -m "feat(release): ship flat macos app artifacts"
```
