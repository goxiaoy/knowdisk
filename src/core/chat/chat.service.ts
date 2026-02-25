import type {
  ChatSendStreamEvent,
  ChatService,
  ChatServiceDeps,
  CitationSeed,
  OpenAiChatMessage,
  OpenAiToolCall,
  RetrievalToolOutput,
  ToolExecutionResult,
} from "./chat.service.types";
import type { ChatCitation, ChatMessage, ChatSession } from "./chat.repository.types";

const SYSTEM_PROMPT =
  "You are Know Disk assistant. Use available tools to search local knowledge when needed. Cite concrete files when possible.";

const TOOL_DEFS = [
  {
    type: "function",
    function: {
      name: "search_local_knowledge",
      description: "Search local indexed knowledge chunks by semantic similarity.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string" },
          top_k: { type: "integer", minimum: 1 },
        },
        required: ["query"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_source_chunk_info",
      description: "Get raw indexed chunk metadata by source path.",
      parameters: {
        type: "object",
        properties: {
          source_path: { type: "string" },
        },
        required: ["source_path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "retrieve_document_by_path",
      description: "Retrieve all indexed chunks and merged content by source path.",
      parameters: {
        type: "object",
        properties: {
          source_path: { type: "string" },
        },
        required: ["source_path"],
      },
    },
  },
] as const;

export function createChatService(deps: ChatServiceDeps): ChatService {
  const fetchImpl = deps.fetchImpl ?? fetch;

  return {
    close() {
      deps.repository.close();
    },
    listSessions() {
      return deps.repository.listSessions();
    },
    createSession(input?: { title?: string }): ChatSession {
      return deps.repository.createSession({
        title: input?.title?.trim() || "New Chat",
      });
    },
    renameSession(sessionId: string, title: string) {
      deps.repository.renameSession(sessionId, title.trim() || "New Chat");
    },
    deleteSession(sessionId: string) {
      deps.repository.deleteSession(sessionId);
    },
    listMessages(sessionId: string): Array<ChatMessage & { citations?: ChatCitation[] }> {
      const rows = deps.repository.listMessages(sessionId);
      return rows.map((row) => {
        if (row.role !== "assistant") {
          return row;
        }
        return {
          ...row,
          citations: deps.repository.listCitations(row.id),
        };
      });
    },
    async sendMessage(
      input: { sessionId: string; content: string; shouldStop?: () => boolean },
      onEvent: (event: ChatSendStreamEvent) => void,
    ) {
      const text = input.content.trim();
      if (!text) {
        onEvent({ type: "error", error: "Message is empty." });
        return;
      }

      const cfg = deps.config.getConfig();
      const apiKey = cfg.chat.openai.apiKey.trim();
      if (!apiKey) {
        onEvent({ type: "error", error: "OpenAI API key is missing." });
        return;
      }

      const userMessage = deps.repository.createMessage({
        sessionId: input.sessionId,
        role: "user",
        content: text,
        status: "done",
      });
      const sessions = deps.repository.listSessions();
      const session = sessions.find((item) => item.id === input.sessionId);
      if (session && session.title === "New Chat") {
        deps.repository.renameSession(input.sessionId, titleFromPrompt(text));
      }
      void userMessage;

      const assistant = deps.repository.createMessage({
        sessionId: input.sessionId,
        role: "assistant",
        content: "",
        status: "streaming",
        model: cfg.chat.openai.model,
      });

      const citations: CitationSeed[] = [];
      let output = "";

      try {
        const history = deps.repository.listMessages(input.sessionId);
        const transcript: OpenAiChatMessage[] = [
          { role: "system", content: SYSTEM_PROMPT },
          ...history
            .filter((row) => row.id !== assistant.id)
            .map((row) => ({ role: row.role, content: row.content })),
        ];

        const finalText = await generateWithTools({
          apiKey,
          model: cfg.chat.openai.model,
          messages: transcript,
          fetchImpl,
          retrieval: deps.retrieval,
          collectCitations(seed) {
            citations.push(...seed);
          },
          shouldStop: input.shouldStop,
        });

        for (const chunk of chunkText(finalText)) {
          if (input.shouldStop?.()) {
            break;
          }
          output += chunk;
          deps.repository.updateMessageContent(assistant.id, output);
          onEvent({ type: "chunk", content: chunk });
        }

        deps.repository.updateMessageStatus(assistant.id, "done");
        deps.repository.replaceCitations(assistant.id, dedupeCitations(citations));
        const doneMessage = deps.repository
          .listMessages(input.sessionId)
          .find((row) => row.id === assistant.id);
        if (!doneMessage) {
          onEvent({ type: "error", error: "Assistant message not found after completion." });
          return;
        }
        const doneCitations = deps.repository.listCitations(assistant.id);
        onEvent({ type: "done", message: doneMessage, citations: doneCitations });
      } catch (error) {
        deps.repository.updateMessageStatus(assistant.id, "error");
        const message = error instanceof Error ? error.message : String(error);
        onEvent({ type: "error", error: message });
      }
    },
  };
}

async function generateWithTools(input: {
  apiKey: string;
  model: string;
  messages: OpenAiChatMessage[];
  fetchImpl: typeof fetch;
  retrieval: ChatServiceDeps["retrieval"];
  collectCitations: (seed: CitationSeed[]) => void;
  shouldStop?: () => boolean;
}): Promise<string> {
  const transcript = [...input.messages];

  for (let i = 0; i < 5; i += 1) {
    if (input.shouldStop?.()) {
      break;
    }
    const result = await requestOpenAiChat(input.fetchImpl, {
      apiKey: input.apiKey,
      model: input.model,
      messages: transcript,
    });
    const choice = result.choices?.[0];
    const message = choice?.message;
    if (!message) {
      throw new Error("OpenAI response missing assistant message.");
    }
    const toolCalls = message.tool_calls ?? [];
    if (toolCalls.length === 0) {
      return message.content ?? "";
    }

    transcript.push({
      role: "assistant",
      content: message.content ?? "",
      tool_calls: toolCalls,
    });

    for (const call of toolCalls) {
      const toolResult = await executeToolCall(input.retrieval, call);
      input.collectCitations(toolResult.citations);
      transcript.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(toolResult.payload),
      });
    }
  }

  return "";
}

async function executeToolCall(
  retrieval: ChatServiceDeps["retrieval"],
  call: OpenAiToolCall,
): Promise<ToolExecutionResult> {
  const args = parseArgs(call.function.arguments);
  if (call.function.name === "search_local_knowledge") {
    const query = String(args.query ?? "").trim();
    const topK = toPositiveInt(args.top_k, 5);
    const data = await retrieval.search(query, { topK });
    return {
      toolName: call.function.name,
      payload: {
        kind: "search",
        data,
      } satisfies RetrievalToolOutput,
      citations: data.reranked.map((row) => ({
        sourcePath: row.sourcePath,
        chunkId: row.chunkId,
        score: row.score,
        chunkTextPreview: row.chunkText.slice(0, 300),
        startOffset: row.startOffset,
        endOffset: row.endOffset,
      })),
    };
  }

  if (call.function.name === "get_source_chunk_info") {
    const sourcePath = String(args.source_path ?? "").trim();
    const chunks = await retrieval.getSourceChunkInfoByPath(sourcePath);
    return {
      toolName: call.function.name,
      payload: {
        kind: "source_chunk_info",
        data: {
          sourcePath,
          chunks,
        },
      } satisfies RetrievalToolOutput,
      citations: chunks.map((row) => ({
        sourcePath: row.sourcePath,
        chunkId: row.chunkId,
        score: 0,
        chunkTextPreview: `chunk:${row.chunkId}`,
        startOffset: row.startOffset,
        endOffset: row.endOffset,
      })),
    };
  }

  if (call.function.name === "retrieve_document_by_path") {
    const sourcePath = String(args.source_path ?? "").trim();
    const chunks = await retrieval.retrieveBySourcePath(sourcePath, false);
    return {
      toolName: call.function.name,
      payload: {
        kind: "retrieve_document",
        data: {
          sourcePath,
          chunkCount: chunks.length,
          content: chunks.map((row) => row.chunkText).join("\n\n"),
          chunks,
        },
      } satisfies RetrievalToolOutput,
      citations: chunks.map((row) => ({
        sourcePath: row.sourcePath,
        chunkId: row.chunkId,
        score: row.score,
        chunkTextPreview: row.chunkText.slice(0, 300),
        startOffset: row.startOffset,
        endOffset: row.endOffset,
      })),
    };
  }

  return {
    toolName: call.function.name,
    payload: { error: `Unsupported tool: ${call.function.name}` },
    citations: [],
  };
}

function parseArgs(input: string): Record<string, unknown> {
  if (!input) {
    return {};
  }
  try {
    return JSON.parse(input) as Record<string, unknown>;
  } catch {
    return {};
  }
}

async function requestOpenAiChat(
  fetchImpl: typeof fetch,
  input: {
    apiKey: string;
    model: string;
    messages: OpenAiChatMessage[];
  },
): Promise<{
  choices?: Array<{
    message?: {
      role?: "assistant";
      content?: string;
      tool_calls?: OpenAiToolCall[];
    };
  }>;
}> {
  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${input.apiKey}`,
    },
    body: JSON.stringify({
      model: input.model,
      messages: input.messages,
      tools: TOOL_DEFS,
      tool_choice: "auto",
      temperature: 0.2,
      stream: false,
    }),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI chat request failed (${response.status}): ${detail}`);
  }
  return (await response.json()) as {
    choices?: Array<{
      message?: {
        role?: "assistant";
        content?: string;
        tool_calls?: OpenAiToolCall[];
      };
    }>;
  };
}

function chunkText(content: string): string[] {
  if (!content) {
    return [];
  }
  const chunks: string[] = [];
  for (let i = 0; i < content.length; i += 32) {
    chunks.push(content.slice(i, i + 32));
  }
  return chunks;
}

function dedupeCitations(rows: CitationSeed[]): CitationSeed[] {
  const map = new Map<string, CitationSeed>();
  for (const row of rows) {
    const key = `${row.sourcePath}::${row.chunkId}`;
    const current = map.get(key);
    if (!current || row.score > current.score) {
      map.set(key, row);
    }
  }
  return Array.from(map.values());
}

function toPositiveInt(value: unknown, fallback: number) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    return fallback;
  }
  return n;
}

function titleFromPrompt(content: string) {
  const trimmed = content.trim();
  if (!trimmed) {
    return "New Chat";
  }
  return trimmed.slice(0, 40);
}
