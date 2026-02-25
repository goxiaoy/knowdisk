# Home AI Chat Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build a chat-first Home experience with OpenAI streaming chat, automatic retrieval tool-calling, and full SQLite-backed session/message/citation persistence.

**Architecture:** Add a new `core/chat` service layer with repository + provider abstraction (`ChatProvider`) and an OpenAI provider implementation. Expose chat/session RPC methods in Bun main process and add a chat-first React Home UI with session sidebar, streaming thread, composer, and citation rendering. Reuse in-process retrieval service for tool execution (full retrieval tool set) and persist all chat data into SQLite.

**Tech Stack:** Bun, TypeScript, React, Electrobun RPC, bun:sqlite, existing retrieval/indexing services, Bun test runner.

---

### Task 1: Extend Config Model For Chat Settings

**Files:**
- Modify: `src/core/config/config.types.ts`
- Modify: `src/core/config/default-config.ts`
- Modify: `src/core/config/config.service.test.ts`

**Step 1: Write the failing test**

Add/update config test to assert `chat` defaults exist:

```ts
expect(config.chat.provider).toBe("openai");
expect(config.chat.openai.model).toBe("gpt-4.1-mini");
expect(config.chat.openai.apiKey).toBe("");
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/config/config.service.test.ts`
Expected: FAIL with missing `chat` fields in types/defaults.

**Step 3: Write minimal implementation**

Add `chat` types and defaults:

```ts
export type ChatProviderId = "openai";
export type OpenAiChatModelId = "gpt-4.1-mini" | "gpt-4.1";
```

and in default config:

```ts
chat: { provider: "openai", openai: { apiKey: "", model: "gpt-4.1-mini" } }
```

**Step 4: Run test to verify it passes**

Run: `bun test src/core/config/config.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/config/config.types.ts src/core/config/default-config.ts src/core/config/config.service.test.ts
git commit -m "feat(config): add chat provider settings"
```

### Task 2: Add Chat Persistence Repository (SQLite)

**Files:**
- Create: `src/core/chat/chat.repository.types.ts`
- Create: `src/core/chat/chat.repository.ts`
- Create: `src/core/chat/chat.repository.test.ts`

**Step 1: Write the failing test**

Create tests for CRUD + cascade delete:

```ts
test("creates session, appends messages, stores citations", () => {
  const repo = createChatRepository({ dbPath: ":memory:" });
  const s = repo.createSession({ title: "New Chat" });
  const m = repo.createMessage({ sessionId: s.id, role: "assistant", content: "ok", status: "done" });
  repo.replaceCitations(m.id, [{ sourcePath: "/a.md", chunkId: "c1", score: 0.9, chunkTextPreview: "txt" }]);
  expect(repo.listSessions()[0].id).toBe(s.id);
  expect(repo.listMessages(s.id)).toHaveLength(1);
  expect(repo.listCitations(m.id)).toHaveLength(1);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/chat/chat.repository.test.ts`
Expected: FAIL (`createChatRepository` missing).

**Step 3: Write minimal implementation**

Implement schema + repository methods:
- `createSession`, `renameSession`, `deleteSession`, `listSessions`
- `createMessage`, `updateMessageContent`, `updateMessageStatus`, `listMessages`
- `replaceCitations`, `listCitations`

Use foreign key cascade from session -> messages and message -> citations.

**Step 4: Run test to verify it passes**

Run: `bun test src/core/chat/chat.repository.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/chat/chat.repository.types.ts src/core/chat/chat.repository.ts src/core/chat/chat.repository.test.ts
git commit -m "feat(chat): add sqlite chat repository"
```

### Task 3: Build OpenAI Chat Provider Abstraction

**Files:**
- Create: `src/core/chat/provider/chat.provider.types.ts`
- Create: `src/core/chat/provider/openai.chat.provider.ts`
- Create: `src/core/chat/provider/openai.chat.provider.test.ts`

**Step 1: Write the failing test**

Add tests for request mapping and tool schema inclusion:

```ts
test("maps chat config and tools into openai stream request", async () => {
  const provider = createOpenAiChatProvider({ fetchImpl: mockFetchOkStream });
  await provider.streamResponse({ apiKey: "k", model: "gpt-4.1-mini", messages: [], tools: [tool] });
  expect(mockFetchOkStream).toHaveBeenCalled();
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/chat/provider/openai.chat.provider.test.ts`
Expected: FAIL (provider not implemented).

**Step 3: Write minimal implementation**

Define provider interface and OpenAI implementation:

```ts
export type ChatProvider = {
  streamResponse(input: StreamChatInput): Promise<AsyncIterable<ChatStreamEvent>>;
};
```

Implement API call with bearer auth, fixed model enum, and tool schema payload support.

**Step 4: Run test to verify it passes**

Run: `bun test src/core/chat/provider/openai.chat.provider.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/chat/provider/chat.provider.types.ts src/core/chat/provider/openai.chat.provider.ts src/core/chat/provider/openai.chat.provider.test.ts
git commit -m "feat(chat): add openai chat provider"
```

### Task 4: Implement Chat Service Tool Loop + Streaming

**Files:**
- Create: `src/core/chat/chat.service.types.ts`
- Create: `src/core/chat/chat.service.ts`
- Create: `src/core/chat/chat.service.test.ts`

**Step 1: Write the failing test**

Add tests for:
- user message persisted before generation
- tool call executes retrieval and continues
- stream chunks merge into assistant message
- stop behavior marks interrupted completion

Example test skeleton:

```ts
test("runs tool-call loop and persists assistant + citations", async () => {
  const svc = createChatService(deps);
  const out = await svc.sendMessage({ sessionId, content: "问一下本地文档" });
  expect(out.message.role).toBe("assistant");
  expect(out.citations.length).toBeGreaterThan(0);
});
```

**Step 2: Run test to verify it fails**

Run: `bun test src/core/chat/chat.service.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Implement service orchestration:
- load message history
- append new user message
- call provider stream
- execute retrieval tools (`search_local_knowledge`, `get_source_chunk_info`, `retrieve_document_by_path`)
- continue loop until final assistant text
- persist assistant + citations

**Step 4: Run test to verify it passes**

Run: `bun test src/core/chat/chat.service.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/core/chat/chat.service.types.ts src/core/chat/chat.service.ts src/core/chat/chat.service.test.ts
git commit -m "feat(chat): add streaming chat service with retrieval tools"
```

### Task 5: Wire Chat Service Into DI Container

**Files:**
- Modify: `src/bun/app.container.ts`
- Modify: `src/bun/app.container.test.ts`

**Step 1: Write the failing test**

Update container test to assert `chatService` exists and is configured.

**Step 2: Run test to verify it fails**

Run: `bun test src/bun/app.container.test.ts`
Expected: FAIL (`chatService` missing).

**Step 3: Write minimal implementation**

- Register chat repository/provider/service in container.
- Inject retrieval service + config + logger dependencies.
- Expose `chatService` on `AppContainer`.

**Step 4: Run test to verify it passes**

Run: `bun test src/bun/app.container.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/app.container.ts src/bun/app.container.test.ts
git commit -m "feat(bun): register chat service in container"
```

### Task 6: Add Chat RPC Contracts And Bun Main Handlers

**Files:**
- Modify: `src/bun/index.ts`
- Modify: `src/mainview/services/bun.rpc.ts`
- Create: `src/mainview/services/chat.stream.client.ts`
- Create: `src/mainview/services/chat.stream.client.test.ts`

**Step 1: Write the failing test**

Add tests for RPC contract calls and stream-event handling.

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/services/chat.stream.client.test.ts`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add RPCs:
- `chat_list_sessions`
- `chat_create_session`
- `chat_rename_session`
- `chat_delete_session`
- `chat_list_messages`
- `chat_send_message_start`
- `chat_stop_stream`

Implement event-channel messages for stream chunks and completion payload.

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/services/chat.stream.client.test.ts`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/bun/index.ts src/mainview/services/bun.rpc.ts src/mainview/services/chat.stream.client.ts src/mainview/services/chat.stream.client.test.ts
git commit -m "feat(rpc): add chat session and streaming handlers"
```

### Task 7: Build Chat UI Components (Home Chat-First)

**Files:**
- Modify: `src/mainview/components/home/HomePage.tsx`
- Create: `src/mainview/components/home/chat/SessionSidebar.tsx`
- Create: `src/mainview/components/home/chat/ChatThread.tsx`
- Create: `src/mainview/components/home/chat/ChatComposer.tsx`
- Create: `src/mainview/components/home/chat/CitationList.tsx`
- Modify: `src/mainview/components/home/HomePage.test.tsx`

**Step 1: Write the failing test**

Add Home tests for:
- chat layout renders
- sending message shows streaming assistant content
- citation section appears for assistant message

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/home/HomePage.test.tsx`
Expected: FAIL (new UI missing).

**Step 3: Write minimal implementation**

Implement chat-first Home with:
- session sidebar actions
- chat thread messages
- composer send/stop
- citations expandable UI
- retrieval debug panel retained as collapsed secondary panel

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/home/HomePage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/components/home/HomePage.tsx src/mainview/components/home/chat/SessionSidebar.tsx src/mainview/components/home/chat/ChatThread.tsx src/mainview/components/home/chat/ChatComposer.tsx src/mainview/components/home/chat/CitationList.tsx src/mainview/components/home/HomePage.test.tsx
git commit -m "feat(home): implement chat-first home experience"
```

### Task 8: Add Chat Settings UI (Dedicated API Key + Fixed Model Dropdown)

**Files:**
- Modify: `src/mainview/components/settings/SettingsPage.tsx`
- Modify: `src/mainview/components/settings/SettingsPage.test.tsx`

**Step 1: Write the failing test**

Add Settings tests:
- chat model dropdown renders fixed options
- API key save updates config.chat.openai.apiKey

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/settings/SettingsPage.test.tsx`
Expected: FAIL.

**Step 3: Write minimal implementation**

Add Chat Settings section:
- provider display (`openai`)
- model dropdown (`gpt-4.1-mini`, `gpt-4.1`)
- masked API key input
- save handler updates config service

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/settings/SettingsPage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/components/settings/SettingsPage.tsx src/mainview/components/settings/SettingsPage.test.tsx
git commit -m "feat(settings): add chat openai configuration"
```

### Task 9: Add API-Key Missing Empty State + Session UX Guards

**Files:**
- Modify: `src/mainview/components/home/HomePage.tsx`
- Modify: `src/mainview/components/home/HomePage.test.tsx`

**Step 1: Write the failing test**

Add tests for:
- empty-state if chat key not configured
- switching session while streaming triggers stop

**Step 2: Run test to verify it fails**

Run: `bun test src/mainview/components/home/HomePage.test.tsx`
Expected: FAIL.

**Step 3: Write minimal implementation**

- Render guided empty state with Settings call-to-action when key is empty.
- Ensure session switch triggers stop for active stream.
- Add delete-session confirmation flow.

**Step 4: Run test to verify it passes**

Run: `bun test src/mainview/components/home/HomePage.test.tsx`
Expected: PASS.

**Step 5: Commit**

```bash
git add src/mainview/components/home/HomePage.tsx src/mainview/components/home/HomePage.test.tsx
git commit -m "feat(chat-ui): add empty state and stream safety guards"
```

### Task 10: End-to-End Verification + Docs Update

**Files:**
- Modify: `README.md`
- Modify: `README.zh-CN.md`
- Optional: `docs/plans/verification-checklist-local-rag-mcp.md` (if checklist needs chat coverage)

**Step 1: Add/adjust tests where needed**

If any scenario still untested (citation rendering, RPC stop behavior), add targeted tests before final run.

**Step 2: Run full verification suite**

Run:
- `bun test`
- `bunx tsc --noEmit -p tsconfig.typecheck.json`
- `bun run build`

Expected:
- all tests PASS
- no type errors
- build success

**Step 3: Update docs minimally**

Document:
- Home chat-first UX
- Chat OpenAI key/model config
- Retrieval tools auto-calling + citation behavior

**Step 4: Final commit**

```bash
git add README.md README.zh-CN.md docs/plans/verification-checklist-local-rag-mcp.md
git commit -m "docs: document chat-first home and openai chat config"
```

## Notes For Execution

- Use `@superpowers/test-driven-development` before each implementation change set.
- Use `@superpowers/systematic-debugging` for any unexpected failures.
- Keep commits small and task-scoped; do not batch multiple tasks in one commit.
- Do not add extra provider implementations or migration logic in this cycle (YAGNI).
