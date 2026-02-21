# Local RAG MCP Desktop Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a desktop app that indexes local files into bundled zvec, maintains index via watch/schedule/manual flows, and exposes MCP retrieval tools for Claude Desktop.

**Architecture:** Keep UI thin and route behavior through internal services: Config, FileSystem abstraction, Parser registry, Indexing, Retrieval, and MCP services. Implement text-first parsing and deterministic Top-K retrieval first, then layer reliability/fallback behavior. Keep advanced options hidden behind safe presets.

**Tech Stack:** Electrobun, Bun, TypeScript, React, Tailwind, zvec (bundled), node fs APIs, cron/timer scheduling, MCP server protocol.

---

References: @brainstorming @writing-plans @test-driven-development @systematic-debugging @verification-before-completion

### Task 1: Establish Test Harness For Core Services

**Files:**
- Create: `src/core/test/setup.ts`
- Create: `src/core/config/config.service.test.ts`
- Modify: `package.json`

**Step 1: Write the failing test**

```ts
// src/core/config/config.service.test.ts
import { describe, expect, test } from "bun:test";
import { getDefaultConfig } from "./config.service";

describe("getDefaultConfig", () => {
  test("returns safe-preset defaults", () => {
    const cfg = getDefaultConfig();
    expect(cfg.ui.mode).toBe("safe");
    expect(cfg.indexing.watch.enabled).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/config/config.service.test.ts`
Expected: FAIL with module or symbol not found.

**Step 3: Write minimal implementation**

```ts
// src/core/config/config.service.ts
export function getDefaultConfig() {
  return {
    ui: { mode: "safe" as const },
    indexing: { watch: { enabled: true } },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/config/config.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add package.json src/core/test/setup.ts src/core/config/config.service.ts src/core/config/config.service.test.ts
git commit -m "test: bootstrap core service tests"
```

### Task 2: Implement Config Schema, Validation, And Migration

**Files:**
- Create: `src/core/config/config.types.ts`
- Modify: `src/core/config/config.service.ts`
- Modify: `src/core/config/config.service.test.ts`

**Step 1: Write the failing test**

```ts
test("rejects cloud provider without endpoint", () => {
  const result = validateConfig({
    ...getDefaultConfig(),
    embedding: { mode: "cloud", model: "text-embed-3", endpoint: "" },
  });
  expect(result.ok).toBe(false);
});

test("migrates v0 config to v1", () => {
  const migrated = migrateConfig({ version: 0, sources: [] });
  expect(migrated.version).toBe(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/config/config.service.test.ts`
Expected: FAIL because `validateConfig`/`migrateConfig` are missing.

**Step 3: Write minimal implementation**

```ts
export function validateConfig(cfg: AppConfig): { ok: boolean; errors: string[] } {
  if (cfg.embedding.mode === "cloud" && !cfg.embedding.endpoint) {
    return { ok: false, errors: ["embedding.endpoint is required for cloud mode"] };
  }
  return { ok: true, errors: [] };
}

export function migrateConfig(input: unknown): AppConfig {
  const v = (input as { version?: number }).version ?? 0;
  if (v === 1) return input as AppConfig;
  return { ...getDefaultConfig(), version: 1 };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/config/config.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/config/config.types.ts src/core/config/config.service.ts src/core/config/config.service.test.ts
git commit -m "feat: add config validation and migration"
```

### Task 3: Build File System Abstraction Layer With Watch Capability Detection

**Files:**
- Create: `src/core/fs/fs.types.ts`
- Create: `src/core/fs/fs.service.ts`
- Create: `src/core/fs/fs.service.test.ts`

**Step 1: Write the failing test**

```ts
import { describe, expect, test } from "bun:test";
import { normalizeEvent } from "./fs.service";

describe("normalizeEvent", () => {
  test("maps rename to canonical renamed event", () => {
    const event = normalizeEvent("rename", "/tmp/a.txt", "/tmp/b.txt");
    expect(event.type).toBe("renamed");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/fs/fs.service.test.ts`
Expected: FAIL with missing implementation.

**Step 3: Write minimal implementation**

```ts
export function normalizeEvent(kind: string, path: string, nextPath?: string) {
  if (kind === "rename" && nextPath) return { type: "renamed" as const, path, nextPath };
  if (kind === "rename") return { type: "updated" as const, path };
  if (kind === "change") return { type: "updated" as const, path };
  return { type: "updated" as const, path };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/fs/fs.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/fs/fs.types.ts src/core/fs/fs.service.ts src/core/fs/fs.service.test.ts
git commit -m "feat: add filesystem abstraction and event normalization"
```

### Task 4: Add Parser Registry And Text-First Parsers

**Files:**
- Create: `src/core/parser/parser.types.ts`
- Create: `src/core/parser/parser.registry.ts`
- Create: `src/core/parser/parsers/text.parser.ts`
- Create: `src/core/parser/parser.registry.test.ts`

**Step 1: Write the failing test**

```ts
test("routes .md files to markdown parser", () => {
  const parser = resolveParser({ ext: ".md", mime: "text/markdown" });
  expect(parser.id).toBe("markdown");
});

test("returns unsupported for .pdf in v1", () => {
  const parser = resolveParser({ ext: ".pdf", mime: "application/pdf" });
  expect(parser.id).toBe("unsupported");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/parser/parser.registry.test.ts`
Expected: FAIL with missing `resolveParser`.

**Step 3: Write minimal implementation**

```ts
export function resolveParser(meta: { ext?: string; mime?: string }) {
  if (meta.ext === ".md") return { id: "markdown", parse: (input: string) => ({ text: input }) };
  if (meta.ext === ".txt" || meta.ext === ".json" || meta.ext === ".yml" || meta.ext === ".yaml") {
    return { id: "text", parse: (input: string) => ({ text: input }) };
  }
  return { id: "unsupported", parse: () => ({ text: "", skipped: "UNSUPPORTED_TYPE" as const }) };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/parser/parser.registry.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/parser/parser.types.ts src/core/parser/parser.registry.ts src/core/parser/parsers/text.parser.ts src/core/parser/parser.registry.test.ts
git commit -m "feat: add parser registry with text-first coverage"
```

### Task 5: Implement Chunking And Deterministic Chunk IDs

**Files:**
- Create: `src/core/indexing/chunking.ts`
- Create: `src/core/indexing/chunking.test.ts`

**Step 1: Write the failing test**

```ts
test("produces stable chunk ids for same content", () => {
  const a = chunkDocument({ path: "a.md", text: "hello world" });
  const b = chunkDocument({ path: "a.md", text: "hello world" });
  expect(a[0].chunkId).toBe(b[0].chunkId);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/indexing/chunking.test.ts`
Expected: FAIL with missing `chunkDocument`.

**Step 3: Write minimal implementation**

```ts
import { createHash } from "node:crypto";

export function chunkDocument(input: { path: string; text: string }) {
  const checksum = createHash("sha256").update(input.path + "\n" + input.text).digest("hex");
  return [{ chunkId: `${input.path}#0#${checksum.slice(0, 12)}`, content: input.text, checksum }];
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/indexing/chunking.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/indexing/chunking.ts src/core/indexing/chunking.test.ts
git commit -m "feat: add deterministic chunking"
```

### Task 6: Implement Embedding Provider Abstraction (Local/Cloud)

**Files:**
- Create: `src/core/embedding/embedding.types.ts`
- Create: `src/core/embedding/embedding.service.ts`
- Create: `src/core/embedding/embedding.service.test.ts`

**Step 1: Write the failing test**

```ts
test("uses configured local provider", async () => {
  const provider = makeEmbeddingProvider({ mode: "local", model: "bge-small" });
  const vec = await provider.embed("hello");
  expect(Array.isArray(vec)).toBe(true);
  expect(vec.length).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/embedding/embedding.service.test.ts`
Expected: FAIL with missing factory.

**Step 3: Write minimal implementation**

```ts
export function makeEmbeddingProvider(cfg: { mode: "local" | "cloud"; model: string }) {
  return {
    async embed(text: string) {
      const seed = text.length + cfg.model.length;
      return [seed, seed / 2, seed / 3];
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/embedding/embedding.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/embedding/embedding.types.ts src/core/embedding/embedding.service.ts src/core/embedding/embedding.service.test.ts
git commit -m "feat: add embedding provider abstraction"
```

### Task 7: Add zvec Repository Adapter

**Files:**
- Create: `src/core/vector/vector.repository.ts`
- Create: `src/core/vector/vector.repository.test.ts`

**Step 1: Write the failing test**

```ts
test("upserts and searches top-k", async () => {
  const repo = createVectorRepository();
  await repo.upsert([{ chunkId: "a", vector: [1, 0], metadata: { sourcePath: "a.md" } }]);
  const results = await repo.search([1, 0], { topK: 1 });
  expect(results[0]?.chunkId).toBe("a");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/vector/vector.repository.test.ts`
Expected: FAIL with missing repository methods.

**Step 3: Write minimal implementation**

```ts
export function createVectorRepository() {
  const rows: Array<{ chunkId: string; vector: number[]; metadata: { sourcePath: string } }> = [];
  return {
    async upsert(input: typeof rows) {
      for (const row of input) {
        const idx = rows.findIndex((r) => r.chunkId === row.chunkId);
        if (idx >= 0) rows[idx] = row;
        else rows.push(row);
      }
    },
    async search(query: number[], opts: { topK: number }) {
      const scored = rows.map((r) => ({ ...r, score: dot(query, r.vector) }));
      scored.sort((a, b) => b.score - a.score || a.chunkId.localeCompare(b.chunkId));
      return scored.slice(0, opts.topK);
    },
  };
}

function dot(a: number[], b: number[]) {
  return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/vector/vector.repository.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/vector/vector.repository.ts src/core/vector/vector.repository.test.ts
git commit -m "feat: add vector repository adapter for zvec"
```

### Task 8: Implement Indexing Service (Full, Incremental, Scheduled Reconcile)

**Files:**
- Create: `src/core/indexing/indexing.service.ts`
- Create: `src/core/indexing/indexing.service.test.ts`

**Step 1: Write the failing test**

```ts
test("scheduled reconcile repairs missing chunk", async () => {
  const svc = createIndexingService(fakeDeps);
  await svc.runFullRebuild("test");
  await fakeDeps.vectorRepo.deleteByChunkId("a.md#0#123");
  const report = await svc.runScheduledReconcile();
  expect(report.repaired).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/indexing/indexing.service.test.ts`
Expected: FAIL with missing service methods.

**Step 3: Write minimal implementation**

```ts
export function createIndexingService(deps: IndexingDeps) {
  return {
    async runFullRebuild(reason: string) {
      return deps.pipeline.rebuild(reason);
    },
    async runIncremental(changes: FileChange[]) {
      return deps.pipeline.incremental(changes);
    },
    async runScheduledReconcile() {
      return deps.pipeline.reconcile();
    },
    getIndexStatus() {
      return deps.pipeline.status();
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/indexing/indexing.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/indexing/indexing.service.ts src/core/indexing/indexing.service.test.ts
git commit -m "feat: add indexing service with rebuild and reconcile flows"
```

### Task 9: Implement Retrieval Service (Top-K Chunks + Metadata)

**Files:**
- Create: `src/core/retrieval/retrieval.service.ts`
- Create: `src/core/retrieval/retrieval.service.test.ts`

**Step 1: Write the failing test**

```ts
test("returns deterministic top-k with metadata", async () => {
  const svc = createRetrievalService(fakeDeps);
  const result = await svc.search("what is knowdisk", { topK: 2 });
  expect(result.length).toBe(2);
  expect(result[0]).toHaveProperty("sourcePath");
  expect(result[0]).toHaveProperty("chunkText");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/retrieval/retrieval.service.test.ts`
Expected: FAIL with missing service.

**Step 3: Write minimal implementation**

```ts
export function createRetrievalService(deps: RetrievalDeps) {
  return {
    async search(query: string, opts: { topK?: number }) {
      const vec = await deps.embedding.embed(query);
      const rows = await deps.vector.search(vec, { topK: opts.topK ?? deps.defaults.topK });
      return rows.map((row) => ({
        chunkId: row.chunkId,
        chunkText: row.metadata.chunkText,
        sourcePath: row.metadata.sourcePath,
        score: row.score,
        updatedAt: row.metadata.updatedAt,
      }));
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/retrieval/retrieval.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/retrieval/retrieval.service.ts src/core/retrieval/retrieval.service.test.ts
git commit -m "feat: add retrieval service returning top-k chunks"
```

### Task 10: Add MCP Server Tool Contract And Handler

**Files:**
- Create: `src/core/mcp/mcp.server.ts`
- Create: `src/core/mcp/mcp.server.test.ts`
- Modify: `src/bun/index.ts`

**Step 1: Write the failing test**

```ts
test("search_local_knowledge returns retrieval payload", async () => {
  const server = createMcpServer(fakeDeps);
  const res = await server.callTool("search_local_knowledge", { query: "setup", top_k: 3 });
  expect(res.results).toHaveLength(3);
  expect(res.results[0]).toHaveProperty("sourcePath");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/mcp/mcp.server.test.ts`
Expected: FAIL with missing tool registration.

**Step 3: Write minimal implementation**

```ts
export function createMcpServer(deps: { retrieval: { search: (q: string, o: { topK: number }) => Promise<unknown[]> } }) {
  return {
    async callTool(name: string, args: { query: string; top_k?: number }) {
      if (name !== "search_local_knowledge") throw new Error("TOOL_NOT_FOUND");
      const results = await deps.retrieval.search(args.query, { topK: args.top_k ?? 5 });
      return { results };
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/mcp/mcp.server.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/mcp/mcp.server.ts src/core/mcp/mcp.server.test.ts src/bun/index.ts
git commit -m "feat: add mcp search tool for local knowledge"
```

### Task 11: Build Settings UI With Safe Presets + Advanced Panel

**Files:**
- Modify: `src/mainview/App.tsx`
- Create: `src/mainview/components/settings/SettingsPage.tsx`
- Create: `src/mainview/components/settings/SettingsPage.test.tsx`
- Modify: `src/mainview/index.css`

**Step 1: Write the failing test**

```tsx
it("hides advanced section by default", () => {
  render(<SettingsPage />);
  expect(screen.queryByText("Advanced Settings")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show Advanced" }));
  expect(screen.getByText("Advanced Settings")).toBeInTheDocument();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/settings/SettingsPage.test.tsx`
Expected: FAIL (component not found or missing behavior).

**Step 3: Write minimal implementation**

```tsx
export function SettingsPage() {
  const [showAdvanced, setShowAdvanced] = useState(false);
  return (
    <section>
      <h1>Settings</h1>
      <button onClick={() => setShowAdvanced((v) => !v)}>{showAdvanced ? "Hide Advanced" : "Show Advanced"}</button>
      {showAdvanced ? <div>Advanced Settings</div> : null}
    </section>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/settings/SettingsPage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/App.tsx src/mainview/components/settings/SettingsPage.tsx src/mainview/components/settings/SettingsPage.test.tsx src/mainview/index.css
git commit -m "feat: add settings page with safe presets and advanced toggle"
```

### Task 12: Add Health, Activity, And Degraded-Mode Signals

**Files:**
- Create: `src/core/health/health.service.ts`
- Create: `src/core/health/health.service.test.ts`
- Modify: `src/mainview/components/settings/SettingsPage.tsx`

**Step 1: Write the failing test**

```ts
test("aggregate health becomes degraded when watch backend degrades", () => {
  const svc = createHealthService();
  svc.setComponent("watch", "degraded");
  expect(svc.getAppHealth()).toBe("degraded");
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/health/health.service.test.ts`
Expected: FAIL with missing service.

**Step 3: Write minimal implementation**

```ts
export function createHealthService() {
  const states: Record<string, "healthy" | "degraded" | "failed"> = {
    fs: "healthy",
    watch: "healthy",
    parser: "healthy",
    embedding: "healthy",
    zvec: "healthy",
    mcp: "healthy",
  };
  return {
    setComponent(name: string, state: "healthy" | "degraded" | "failed") {
      states[name] = state;
    },
    getAppHealth() {
      if (Object.values(states).includes("failed")) return "failed" as const;
      if (Object.values(states).includes("degraded")) return "degraded" as const;
      return "healthy" as const;
    },
  };
}
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/health/health.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/health/health.service.ts src/core/health/health.service.test.ts src/mainview/components/settings/SettingsPage.tsx
git commit -m "feat: add health aggregation and degraded status surfacing"
```

### Task 13: Verification Gate Before Completion

**Files:**
- Modify: `README.md`
- Create: `docs/plans/verification-checklist-local-rag-mcp.md`

**Step 1: Write failing integration smoke checklist item**

Add checklist entries that are initially unchecked for:
- add source -> index -> MCP query,
- restart persistence,
- degraded watch fallback.

**Step 2: Run full verification commands**

Run:
- `bun test`
- `bun run build`
- `bun run dev` (manual smoke)

Expected:
- tests pass,
- build succeeds,
- manual smoke path validated.

**Step 3: Update checklist with evidence**

Document:
- command outputs summary,
- date/time,
- known gaps.

**Step 4: Commit**

```bash
git add README.md docs/plans/verification-checklist-local-rag-mcp.md
git commit -m "docs: add verification checklist and runbook"
```

## Notes For Execution

- Keep each task isolated and small; do not batch unrelated changes.
- Follow strict TDD for each behavior: RED -> GREEN -> REFACTOR.
- Use incremental commits exactly as listed or finer-grained when needed.
- If a task reveals design drift, pause and update the design doc before continuing.
