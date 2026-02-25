# Home AI Chat Design (OpenAI + Local Retrieval Tools)

Date: 2026-02-25
Status: Approved
Scope: Replace Home with chat-first UX similar to Open WebUI/LibreChat style, with local retrieval tool calling and SQLite-backed conversation management.

## 1. Goals

- Make `Home` the primary AI chat interface.
- Support configurable chat LLM provider settings with API key management; current implementation supports OpenAI only.
- Enable automatic model tool-calling against local retrieval capabilities so the assistant can decide when to run RAG search.
- Persist complete local chat history in SQLite with multi-session management.
- Show retrieval citations under assistant answers.

## 2. Confirmed Product Decisions

- Conversation persistence: full local session management in SQLite.
- Home entry style: chat-first. Existing retrieval debug UI moves to secondary/collapsed area.
- Chat model config: fixed dropdown options (not free text, not runtime model discovery).
- Retrieval tools policy: always enabled/automatic, no user toggle.
- Citation UX: show cited files/snippets under each assistant message.
- Response mode: streaming.
- API key: dedicated Chat OpenAI API key, separate from embedding/reranker keys.
- Tool scope: expose full retrieval tool set (equivalent to current MCP retrieval tools surface).

## 3. Approach Options Considered

### Option A: Direct OpenAI integration without provider abstraction
- Pros: fastest initial delivery.
- Cons: likely refactor when adding more providers later.

### Option B (Selected): Lightweight provider abstraction + OpenAI implementation
- Pros: preserves implementation speed while leaving clean extension point for future providers.
- Cons: modest extra interfaces/boilerplate now.

### Option C: Chat uses local MCP HTTP loopback to invoke tools
- Pros: protocol symmetry with external MCP clients.
- Cons: longer runtime path, harder debugging, unnecessary overhead for in-process use.

## 4. Architecture Design

### 4.1 High-level

- `HomePage` becomes chat-first UI:
  - Session sidebar
  - Chat thread
  - Composer
  - Collapsible retrieval debug panel
- `SettingsPage` gains `Chat Settings` section:
  - provider (OpenAI only for now)
  - fixed model dropdown
  - dedicated API key
- Bun main process gains `ChatService` and chat RPC handlers.
- Retrieval tool execution stays in-process by calling existing retrieval service methods.

### 4.2 New config shape

Extend `AppConfig` with `chat` section:

- `chat.provider`: currently `openai`
- `chat.openai.apiKey`: dedicated key
- `chat.openai.model`: fixed enum/dropdown value
- optional chat defaults (e.g. `temperature`, `maxOutputTokens`) can be deferred unless required

## 5. Persistence Model (SQLite)

### 5.1 `chat_sessions`
- `id` (uuid primary key)
- `title`
- `created_at`
- `updated_at`
- `last_message_at`

### 5.2 `chat_messages`
- `id` (uuid primary key)
- `session_id` (foreign key)
- `role` (`system|user|assistant|tool`)
- `content` (text)
- `status` (`streaming|done|error`)
- `model` (nullable)
- `token_in` (nullable)
- `token_out` (nullable)
- `created_at`

### 5.3 `chat_message_citations`
- `id` (uuid primary key)
- `message_id` (foreign key to assistant message)
- `source_path`
- `chunk_id`
- `score`
- `chunk_text_preview`
- `start_offset` (nullable)
- `end_offset` (nullable)

Note: No migration/legacy compatibility layer is required for this feature.

## 6. Tool-calling Flow

1. User sends message; persist `user` row.
2. `ChatService` starts streaming OpenAI generation with tool schemas for full retrieval tool set.
3. If model emits tool calls:
- execute matching retrieval methods in-process
- persist tool messages as needed
- append tool result back into model context
- continue until final assistant text is produced
4. Stream assistant text chunks to UI.
5. Finalize assistant message (`done` or interrupted completion) and persist full text.
6. Extract/store citations from retrieval tool outputs into `chat_message_citations`.
7. Return message + citations to UI.

## 7. UI/UX Design

### 7.1 Home (chat-first)

- Left: `SessionSidebar`
  - create session
  - list/switch sessions
  - rename
  - delete (with confirmation)
- Center: `ChatThread`
  - message timeline
  - streaming assistant render
  - expandable citations below assistant messages
- Bottom: `ChatComposer`
  - multiline input
  - send button
  - stop button during stream
- Right or secondary area: collapsible retrieval debug panel (existing capabilities retained)

### 7.2 Settings

Add `Chat Settings` card:
- provider: OpenAI (single option for now)
- model: fixed dropdown list
- api key: masked input
- save action updates config immediately for subsequent requests

### 7.3 Behavior details

- New conversation title uses first user prompt snippet (initial heuristic, no extra model call).
- Switching sessions during stream stops current stream to avoid cross-session writes.
- If chat API key is missing, Home shows guided empty-state directing user to Settings.

## 8. Error Handling

- OpenAI request failure: assistant message marked `error`, UI offers retry.
- Tool execution failure: pass tool error payload back to model as tool output so model can gracefully continue.
- User stop: end stream and persist partial assistant output as completed/interrupted state.

## 9. Testing Strategy

### 9.1 Unit
- `ChatService`: stream assembly, tool-call loop, stop path, error path.
- `ChatRepository`: session/message/citation CRUD + cascade delete behavior.
- `OpenAIChatProvider`: request mapping, tool schema wiring, response parsing.

### 9.2 Integration
- RPC flow: create session -> send -> tool call -> assistant done -> citations available.
- Settings update for chat model/api key affects subsequent chat requests.
- Session deletion removes messages/citations.

### 9.3 UI tests
- Chat happy path (new session, send, stream, stop, switch).
- Citation rendering and expand/collapse.
- Missing API key guided empty-state.

## 10. Acceptance Criteria (MVP)

- Home defaults to fully usable chat interface.
- Multi-session management is available and persisted across restarts.
- OpenAI dedicated chat API key and fixed model selection are configurable in Settings.
- Assistant responses stream in real time.
- Retrieval tools are automatically available to the model.
- Assistant responses include viewable citations from retrieval output.
- Error/retry path is visible and functional.

## 11. Non-goals

- Additional providers beyond OpenAI.
- Account sync/cloud sync.
- Migration/legacy compatibility work.
- Plugin/marketplace or advanced permission management.
