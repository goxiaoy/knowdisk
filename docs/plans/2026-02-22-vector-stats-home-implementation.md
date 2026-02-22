# Vector Stats Home Navigation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a Home page with navigation and a full vector collection inspect/stat card backed by zvec data from backend RPC.

**Architecture:** Extend `VectorRepository` with a serializable inspect snapshot built from zvec collection `path/schema/options/stats`, expose it via Bun RPC, then render it in a new `HomePage` card. Keep `SettingsPage` focused on configuration and switch pages via a top-level App nav.

**Tech Stack:** Bun, React, TypeScript, Tailwind classes, electrobun RPC, @zvec/zvec.

---

### Task 1: Add vector inspect types + repository API

**Files:**
- Modify: `src/core/vector/vector.repository.types.ts`
- Modify: `src/core/vector/vector.repository.ts`
- Test: `src/core/vector/vector.repository.test.ts`

1. Add `VectorCollectionInspect` type and `inspect(): Promise<VectorCollectionInspect>` to repository interface.
2. Implement inspect mapping in repository from zvec collection values.
3. Add test asserting inspect returns path/schema/stats and vector dimension.

### Task 2: Expose inspect via app container + Bun RPC + mainview RPC client

**Files:**
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/index.ts`
- Modify: `src/mainview/services/bun.rpc.ts`

1. Add `vectorRepository` on app container output.
2. Add Bun RPC request `get_vector_stats` returning inspect payload.
3. Add mainview RPC typings + helper `getVectorStatsFromBun()`.

### Task 3: Add Home page and Vector Stats card

**Files:**
- Create: `src/mainview/components/home/VectorStatsCard.tsx`
- Create: `src/mainview/components/home/HomePage.tsx`
- Modify: `src/mainview/App.tsx`

1. Create `VectorStatsCard` with periodic refresh and full inspect output.
2. Create `HomePage` containing system-level cards (vector stats + index status).
3. Add `Home/Settings` nav in `App.tsx`, default Home.

### Task 4: Add/adjust tests and run focused verification

**Files:**
- Modify: `src/mainview/components/settings/SettingsPage.test.tsx` (only if selector collisions)
- Create: `src/mainview/components/home/VectorStatsCard.test.tsx` (optional smoke)

1. Run vector repository test file.
2. Run mainview component tests.
3. Fix any compile/test breaks.
