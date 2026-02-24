# Model Download Verify + Retry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在启动时先验证本地模型可运行性，仅对缺失/损坏模型执行下载；下载顺序 embedding→reranker，任务内文件并发；失败自动退避并支持手动重试，进度可解释且不提前 100%。

**Architecture:** 在 `model-download.service` 内显式拆分 `verify` 与 `download` 两阶段。`verify` 并行做本地加载校验，`download` 任务级串行、文件级并行。状态模型扩展为 `verifying/running/failed/completed`，重试改为任务级。UI 按任务展示重试与倒计时，仅失败时显示 `Retry now`。

**Tech Stack:** Bun + TypeScript, electrobun RPC, @huggingface/transformers, pino logging, react/tailwind, bun test.

---

### Task 1: Define Verify/Retry State Model

**Files:**
- Modify: `src/core/model/model-download.service.types.ts`
- Test: `src/bun/model-download-trigger.test.ts`

**Step 1: Write the failing test**

```ts
// add assertion for verifying/failed retry fields shape if needed by call sites
expect(status.retry.maxAttempts).toBeGreaterThan(0);
```

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/model-download-trigger.test.ts`  
Expected: FAIL if type/shape mismatch appears in call sites.

**Step 3: Write minimal implementation**

```ts
// add verify-related fields and task-level retry metadata types
```

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/model-download-trigger.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/model/model-download.service.types.ts src/bun/model-download-trigger.test.ts
git commit -m "refactor(model): extend download status for verify and task retry"
```

### Task 2: Add Startup Verify Stage

**Files:**
- Modify: `src/core/model/model-download.service.ts`
- Modify: `src/bun/index.ts`
- Test: `src/bun/app.container.test.ts`

**Step 1: Write the failing test**

```ts
// startup path: verify passes -> no download task transitions to downloading
expect(status.phase).not.toBe("running");
```

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/app.container.test.ts -t "startup verify"`  
Expected: FAIL because service currently does not expose explicit verify stage.

**Step 3: Write minimal implementation**

```ts
// add startupVerifyAndDownload flow:
// 1) verify local load with local_files_only
// 2) enqueue missing tasks only
```

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/app.container.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/model/model-download.service.ts src/bun/index.ts src/bun/app.container.test.ts
git commit -m "feat(model): add startup verify before download"
```

### Task 3: Enforce Task Order + File Concurrency

**Files:**
- Modify: `src/core/model/model-download.service.ts`
- Test: `src/bun/app.container.test.ts`

**Step 1: Write the failing test**

```ts
// assert embedding-local starts before reranker-local
expect(startOrder).toEqual(["embedding-local", "reranker-local"]);
```

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/app.container.test.ts -t "task order"`  
Expected: FAIL if ordering not deterministic.

**Step 3: Write minimal implementation**

```ts
// keep MODEL_TASK_CONCURRENCY=1 and deterministic buildSpecs order
// keep MODEL_FILE_CONCURRENCY > 1
```

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/app.container.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/model/model-download.service.ts src/bun/app.container.test.ts
git commit -m "feat(model): enforce embedding-first task order"
```

### Task 4: Fix Progress Calculation Contract

**Files:**
- Modify: `src/core/model/model-download.service.ts`
- Modify: `src/mainview/components/status/ModelDownloadCard.tsx`
- Test: `src/mainview/components/home/HomePage.test.tsx`

**Step 1: Write the failing test**

```ts
// running stage should never show 100 until all tasks finished
expect(progress).toBeLessThan(100);
```

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/home/HomePage.test.tsx -t "model progress"`  
Expected: FAIL under previous edge case.

**Step 3: Write minimal implementation**

```ts
// total = sum(remote size), downloaded = final + .part capped by total
// if not all finished and progress >=100 => 99.9
```

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/home/HomePage.test.tsx`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/model/model-download.service.ts src/mainview/components/status/ModelDownloadCard.tsx src/mainview/components/home/HomePage.test.tsx
git commit -m "fix(model): stabilize running progress and byte accounting"
```

### Task 5: Task-Level Retry with Backoff + Retry Now

**Files:**
- Modify: `src/core/model/model-download.service.ts`
- Modify: `src/bun/index.ts`
- Modify: `src/mainview/services/bun.rpc.ts`
- Modify: `src/mainview/components/status/ModelDownloadCard.tsx`
- Test: `src/bun/app.container.test.ts`

**Step 1: Write the failing test**

```ts
// failed task should expose nextRetryAt and exhausted after max attempts
expect(status.retry.exhausted).toBe(true);
```

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/app.container.test.ts -t "retry"`  
Expected: FAIL before task-level retry state finalized.

**Step 3: Write minimal implementation**

```ts
// task retry backoff scheduler, manual retry endpoint, UI retry button on failed only
```

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/app.container.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/model/model-download.service.ts src/bun/index.ts src/mainview/services/bun.rpc.ts src/mainview/components/status/ModelDownloadCard.tsx src/bun/app.container.test.ts
git commit -m "feat(model): add task-level auto backoff and manual retry"
```

### Task 6: Cleanup .part on Exhausted

**Files:**
- Modify: `src/core/model/model-download.service.ts`
- Test: `src/bun/app.container.test.ts`

**Step 1: Write the failing test**

```ts
// after exhausted retry, stale .part should be removed
expect(partExists).toBe(false);
```

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/app.container.test.ts -t "part cleanup"`  
Expected: FAIL before cleanup hook.

**Step 3: Write minimal implementation**

```ts
// recursive .part cleanup when retries exhausted
```

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/app.container.test.ts`  
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/model/model-download.service.ts src/bun/app.container.test.ts
git commit -m "fix(model): cleanup part files when retry exhausted"
```

### Task 7: End-to-End Verification & Docs

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Modify: `docs/plans/2026-02-24-model-download-verify-retry-design.md`

**Step 1: Add/update docs**

```md
Document startup verify, ordered download, progress, retry strategy.
```

**Step 2: Run full validation**

Run: `bun test`  
Expected: PASS.

Run: `bun run build`  
Expected: build success.

**Step 3: Commit**

```bash
git add README.md README.zh-CN.md docs/plans/2026-02-24-model-download-verify-retry-design.md
git commit -m "docs: describe model verify/download/retry workflow"
```
