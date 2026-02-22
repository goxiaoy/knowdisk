# Onboarding + Force Resync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a two-step first-run onboarding flow and a Home `Force Resync` action that destroys vector storage and reindexes all sources.

**Architecture:** Use `App.tsx` as the gatekeeper: render onboarding when `config.onboarding.completed` is false, otherwise render existing app navigation. Add a backend RPC `force_resync` that runs a destructive vector reset followed by indexing rebuild. Reuse existing config/rpc/service patterns and keep changes minimal and test-driven.

**Tech Stack:** Bun, TypeScript, React, electrobun RPC, @zvec/zvec, bun:test.

---

### Task 1: Add onboarding config model + migration defaults

**Files:**
- Modify: `src/core/config/config.types.ts`
- Modify: `src/core/config/config.service.ts`
- Modify: `src/mainview/services/config.service.ts`
- Modify: `src/core/config/config.service.test.ts`

**Step 1: Write the failing test**

```ts
it("migrates onboarding flag and defaults for existing configs", () => {
  const migrated = migrateConfig({ version: 1, sources: [{ path: "/docs", enabled: true }] });
  expect(migrated.onboarding.completed).toBe(true);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/config/config.service.test.ts`
Expected: FAIL because `onboarding` is missing.

**Step 3: Write minimal implementation**

```ts
interface AppConfig { onboarding: { completed: boolean } }
// defaults: completed false
// migration: completed true when sources.length > 0 for existing users
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/config/config.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/config/config.types.ts src/core/config/config.service.ts src/mainview/services/config.service.ts src/core/config/config.service.test.ts
git commit -m "feat: add onboarding config state and migration"
```

### Task 2: Add app-level onboarding gate and shell routing

**Files:**
- Modify: `src/mainview/App.tsx`
- Create: `src/mainview/components/onboarding/OnboardingPage.tsx`
- Create: `src/mainview/components/onboarding/SourceSelectionStep.tsx`
- Create: `src/mainview/components/onboarding/ModelSetupStep.tsx`
- Test: `src/mainview/components/onboarding/OnboardingPage.test.tsx`

**Step 1: Write the failing test**

```ts
it("renders onboarding when onboarding.completed is false", () => {
  // mount App with configService stub returning completed=false
  // expect onboarding heading visible
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/onboarding/OnboardingPage.test.tsx`
Expected: FAIL because component does not exist.

**Step 3: Write minimal implementation**

```tsx
if (!config.onboarding.completed) {
  return <OnboardingPage />;
}
return <AppShell />;
```

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/onboarding/OnboardingPage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/App.tsx src/mainview/components/onboarding/OnboardingPage.tsx src/mainview/components/onboarding/SourceSelectionStep.tsx src/mainview/components/onboarding/ModelSetupStep.tsx src/mainview/components/onboarding/OnboardingPage.test.tsx
git commit -m "feat: add onboarding flow and app gate"
```

### Task 3: Implement onboarding step 1 (required source)

**Files:**
- Modify: `src/mainview/components/onboarding/SourceSelectionStep.tsx`
- Modify: `src/mainview/services/bun.rpc.ts`
- Test: `src/mainview/components/onboarding/OnboardingPage.test.tsx`

**Step 1: Write the failing test**

```ts
it("disables next when no source is configured", () => {
  // expect Next button disabled
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/onboarding/OnboardingPage.test.tsx`
Expected: FAIL due to missing guard.

**Step 3: Write minimal implementation**

```tsx
const canNext = sources.length > 0;
<button disabled={!canNext}>Next</button>
```

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/onboarding/OnboardingPage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/components/onboarding/SourceSelectionStep.tsx src/mainview/components/onboarding/OnboardingPage.test.tsx src/mainview/services/bun.rpc.ts
git commit -m "feat: require at least one source in onboarding step 1"
```

### Task 4: Implement onboarding step 2 (defaults + continue)

**Files:**
- Modify: `src/mainview/components/onboarding/ModelSetupStep.tsx`
- Modify: `src/mainview/components/onboarding/OnboardingPage.tsx`
- Modify: `src/mainview/components/settings/SettingsPage.tsx`
- Test: `src/mainview/components/onboarding/OnboardingPage.test.tsx`

**Step 1: Write the failing test**

```ts
it("allows continue in step 2 without edits and marks onboarding completed", async () => {
  // go to step 2, click Continue
  // expect config.onboarding.completed === true
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/onboarding/OnboardingPage.test.tsx`
Expected: FAIL because continue path is missing.

**Step 3: Write minimal implementation**

```tsx
await saveModelConfig();
configService.updateConfig((c) => ({ ...c, onboarding: { completed: true } }));
onFinished();
```

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/onboarding/OnboardingPage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/components/onboarding/ModelSetupStep.tsx src/mainview/components/onboarding/OnboardingPage.tsx src/mainview/components/settings/SettingsPage.tsx src/mainview/components/onboarding/OnboardingPage.test.tsx
git commit -m "feat: complete onboarding with default model settings"
```

### Task 5: Add vector destroy capability and force resync backend API

**Files:**
- Modify: `src/core/vector/vector.repository.types.ts`
- Modify: `src/core/vector/vector.repository.ts`
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/index.ts`
- Modify: `src/mainview/services/bun.rpc.ts`
- Test: `src/core/vector/vector.repository.test.ts`
- Test: `src/bun/app.container.test.ts`

**Step 1: Write the failing test**

```ts
test("force_resync destroys vector store then runs full rebuild", async () => {
  // assert destroy called before rebuild reason force_resync
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/app.container.test.ts`
Expected: FAIL because `force_resync` flow does not exist.

**Step 3: Write minimal implementation**

```ts
await vectorRepository.destroy();
await indexingService.runFullRebuild("force_resync");
return { ok: true };
```

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/app.container.test.ts src/core/vector/vector.repository.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vector/vector.repository.types.ts src/core/vector/vector.repository.ts src/bun/app.container.ts src/bun/index.ts src/mainview/services/bun.rpc.ts src/core/vector/vector.repository.test.ts src/bun/app.container.test.ts
git commit -m "feat: add backend force resync rpc and vector destroy"
```

### Task 6: Add Home Force Resync button UX

**Files:**
- Modify: `src/mainview/components/home/HomePage.tsx`
- Test: `src/mainview/components/home/HomePage.test.tsx`

**Step 1: Write the failing test**

```ts
it("triggers force resync and disables button while running", async () => {
  // click button
  // expect RPC called once, button disabled during pending
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/home/HomePage.test.tsx`
Expected: FAIL because button/handler is missing.

**Step 3: Write minimal implementation**

```tsx
<button disabled={resyncing} onClick={onForceResync}>Force Resync</button>
```

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/home/HomePage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/components/home/HomePage.tsx src/mainview/components/home/HomePage.test.tsx
git commit -m "feat: add home force resync action"
```

### Task 7: Full verification and cleanup

**Files:**
- Modify: any touched files if fixes needed

**Step 1: Run focused suites**

Run: `bun test src/core/config/config.service.test.ts src/core/vector/vector.repository.test.ts src/bun/app.container.test.ts src/core/mcp/mcp.server.test.ts src/mainview/components/settings/SettingsPage.test.tsx src/mainview/components/onboarding/OnboardingPage.test.tsx src/mainview/components/home/HomePage.test.tsx`
Expected: PASS across changed areas.

**Step 2: Run full tests**

Run: `bun test`
Expected: tests pass; if Bun native panic appears post-run, record as known runtime issue with pass counts.

**Step 3: Manual smoke checks**

Run:
```bash
bun run dev
```
Expected:
- fresh profile enters onboarding,
- step 1 requires source,
- step 2 continue works without edits,
- app enters Home,
- force resync triggers rebuild and status updates.

**Step 4: Final commit (if needed)**

```bash
git add -A
git commit -m "test: finalize onboarding and force resync coverage"
```
