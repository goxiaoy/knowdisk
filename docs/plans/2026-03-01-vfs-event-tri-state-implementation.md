# VFS Tri-State Events + Dual Queue Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `getVersion` to core VFS operations, introduce tri-state change flags with deterministic compaction, and split service event dispatch into fast metadata and debounced content queues.

**Architecture:** Keep `vfs_node_events` as the single source for event compaction. Store tri-state flags (`true/false/null`) in DB and merge using precedence `true > null > false`. In `VfsService`, flush compacted rows into two logical queues: metadata (fast) and content (debounced), routing one event to one or both queues.

**Tech Stack:** TypeScript, Bun SQLite (`bun:sqlite`), Bun test runner, existing VFS service/repository/provider modules.

---

### Task 1: Add API types for `getVersion` and tri-state flags

**Files:**
- Modify: `packages/vfs/src/vfs.service.types.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`

**Step 1: Write the failing test**

Add a test expectation that watch payload supports nullable flags and `upsert` events can carry `null`.

```ts
expect(typeof event.metadataChanged === "boolean" || event.metadataChanged === null).toBe(true);
expect(typeof event.contentUpdated === "boolean" || event.contentUpdated === null).toBe(true);
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts --filter "nullable"`
Expected: FAIL with type mismatch / missing behavior.

**Step 3: Write minimal implementation**

Update types:

```ts
getVersion?: (input: { id: string }) => Promise<string | null>;

export type VfsChangeEvent = {
  type: "upsert" | "delete";
  id: string;
  parentId: string | null;
  contentUpdated: boolean | null;
  metadataChanged: boolean | null;
};
```

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: PASS for updated type assertions.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.service.types.ts packages/vfs/src/vfs.service.runtime.test.ts
git commit -m "feat(vfs): add getVersion and tri-state change flags"
```

### Task 2: Add repository tri-state storage + merge function

**Files:**
- Modify: `packages/vfs/src/vfs.repository.types.ts`
- Modify: `packages/vfs/src/vfs.repository.ts`
- Test: `packages/vfs/src/vfs.repository.test.ts`

**Step 1: Write the failing test**

Add compaction test matrix for one node covering merges:
- `false + null => null`
- `null + true => true`
- `false + false => false`
- `delete` overrides previous upsert row.

```ts
expect(merged.metadataChanged).toBeNull();
expect(merged.contentUpdated).toBe(true);
```

**Step 2: Run test to verify it fails**

Run: `bun test packages/vfs/src/vfs.repository.test.ts --filter "compresses"`
Expected: FAIL because current merge is boolean-only.

**Step 3: Write minimal implementation**

- Change repository event row type:

```ts
contentUpdated: boolean | null;
metadataChanged: boolean | null;
```

- Store nullable values in DB mapping.
- Add helper:

```ts
function mergeTriState(prev: boolean | null, next: boolean | null): boolean | null {
  if (prev === true || next === true) return true;
  if (prev === null || next === null) return null;
  return false;
}
```

- Use helper in `upsertNodeEvents` merge for upsert rows.
- Keep delete override behavior by replacing prior row for same node.

**Step 4: Run test to verify it passes**

Run: `bun test packages/vfs/src/vfs.repository.test.ts`
Expected: PASS with tri-state merge behavior.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.repository.types.ts packages/vfs/src/vfs.repository.ts packages/vfs/src/vfs.repository.test.ts
git commit -m "feat(vfs): support tri-state compaction in vfs_node_events"
```

### Task 3: Implement `getVersion` in local provider and service

**Files:**
- Modify: `packages/vfs/src/provider/local/index.ts`
- Modify: `packages/vfs/src/vfs.service.ts`
- Test: `packages/vfs/src/provider/local/local.provider.test.ts`
- Test: `packages/vfs/src/vfs.integration.test.ts`

**Step 1: Write the failing tests**

1) Local provider `getVersion(id)` returns BLAKE3 for file.
2) Service `getVersion(id)` returns DB `providerVersion` and does not recompute content.

**Step 2: Run tests to verify they fail**

Run:
- `bun test packages/vfs/src/provider/local/local.provider.test.ts --filter "getVersion"`
- `bun test packages/vfs/src/vfs.integration.test.ts --filter "getVersion"`

Expected: FAIL due to missing API.

**Step 3: Write minimal implementation**

- In local provider:

```ts
async getVersion(input) {
  const filePath = resolveRefPath(config.directory, input.id);
  return await computeBlake3File(filePath);
}
```

- In service:

```ts
async getVersion(input) {
  return deps.repository.getNodeById(input.id)?.providerVersion ?? null;
}
```

**Step 4: Run tests to verify they pass**

Run:
- `bun test packages/vfs/src/provider/local/local.provider.test.ts`
- `bun test packages/vfs/src/vfs.integration.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/provider/local/index.ts packages/vfs/src/vfs.service.ts packages/vfs/src/provider/local/local.provider.test.ts packages/vfs/src/vfs.integration.test.ts
git commit -m "feat(vfs): add getVersion for local provider and service"
```

### Task 4: Route service dispatch into fast metadata queue + debounced content queue

**Files:**
- Modify: `packages/vfs/src/vfs.service.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`

**Step 1: Write the failing tests**

Add tests for queue routing:
- metadata-only event: fast listener receives quickly.
- content-only event: content listener receives after debounce.
- both true: both queues receive.
- delete: both queues receive.

**Step 2: Run tests to verify they fail**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts --filter "queue"`
Expected: FAIL with missing split dispatch behavior.

**Step 3: Write minimal implementation**

In service:
- Keep DB compaction write path.
- Add internal two-stage dispatch:

```ts
const FAST_METADATA_MS = 0;
const CONTENT_DEBOUNCE_MS = 120;
```

Routing predicate:

```ts
const needsMetadata = event.type === "delete" || event.metadataChanged !== false;
const needsContent = event.type === "delete" || event.contentUpdated !== false;
```

Dispatch fast metadata queue immediately and content queue via debounce timer.

**Step 4: Run tests to verify they pass**

Run: `bun test packages/vfs/src/vfs.service.runtime.test.ts`
Expected: PASS with deterministic timing windows.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.service.ts packages/vfs/src/vfs.service.runtime.test.ts
git commit -m "feat(vfs): split event dispatch into metadata and content queues"
```

### Task 5: Align change-origin semantics for local provider updates and add-path behavior

**Files:**
- Modify: `packages/vfs/src/vfs.service.ts`
- Modify: `packages/vfs/src/vfs.syncer.ts`
- Test: `packages/vfs/src/vfs.service.runtime.test.ts`
- Test: `packages/vfs/src/vfs.syncer.test.ts`

**Step 1: Write the failing tests**

Add tests asserting:
- Local provider update emits/compacts as `metadataChanged=true`, `contentUpdated=false`.
- Add emits `metadataChanged=true`, `contentUpdated=true`.

**Step 2: Run tests to verify they fail**

Run:
- `bun test packages/vfs/src/vfs.service.runtime.test.ts --filter "local update semantics"`
- `bun test packages/vfs/src/vfs.syncer.test.ts --filter "add semantics"`

Expected: FAIL with old flag derivation behavior.

**Step 3: Write minimal implementation**

- Adjust `toChangeEvent`/event mapping logic to apply local-provider override semantics.
- Ensure add path sets both flags true.
- Preserve delete behavior and tri-state compatibility.

**Step 4: Run tests to verify they pass**

Run:
- `bun test packages/vfs/src/vfs.service.runtime.test.ts`
- `bun test packages/vfs/src/vfs.syncer.test.ts`

Expected: PASS.

**Step 5: Commit**

```bash
git add packages/vfs/src/vfs.service.ts packages/vfs/src/vfs.syncer.ts packages/vfs/src/vfs.service.runtime.test.ts packages/vfs/src/vfs.syncer.test.ts
git commit -m "feat(vfs): enforce local update and add event flag semantics"
```

### Task 6: End-to-end regression run

**Files:**
- Test only; no source changes expected.

**Step 1: Run full relevant suite**

Run:

```bash
bun test packages/vfs/src/vfs.repository.test.ts \
  packages/vfs/src/vfs.service.runtime.test.ts \
  packages/vfs/src/vfs.service.read.test.ts \
  packages/vfs/src/vfs.service.walk.test.ts \
  packages/vfs/src/vfs.syncer.test.ts \
  packages/vfs/src/provider/local/local.provider.test.ts \
  packages/vfs/src/vfs.integration.test.ts \
  packages/vfs/example/app.test.ts
```

Expected: all PASS.

**Step 2: If failures exist, fix in smallest possible commit**

Run targeted test after each fix.

**Step 3: Final commit**

```bash
git add -A
git commit -m "test(vfs): align tri-state events and dual queue behavior"
```
