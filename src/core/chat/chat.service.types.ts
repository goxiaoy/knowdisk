import type { AppConfig } from "../config/config.types";
import type { RetrievalChunkInfo, RetrievalDebugResult, RetrievalResult, RetrievalService } from "../retrieval/retrieval.service.types";
import type { ChatCitation, ChatMessage, ChatRepository, ChatSession } from "./chat.repository.types";

export type ChatServiceDeps = {
  config: {
    getConfig: () => AppConfig;
  };
  retrieval: RetrievalService;
  repository: ChatRepository;
  fetchImpl?: typeof fetch;
  now?: () => number;
};

export type ChatSendStreamEvent =
  | { type: "chunk"; content: string }
  | { type: "done"; message: ChatMessage; citations: ChatCitation[] }
  | { type: "error"; error: string };

export type ChatService = {
  close: () => void;
  listSessions: () => ChatSession[];
  createSession: (input?: { title?: string }) => ChatSession;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  listMessages: (sessionId: string) => Array<ChatMessage & { citations?: ChatCitation[] }>;
  sendMessage: (
    input: { sessionId: string; content: string; shouldStop?: () => boolean },
    onEvent: (event: ChatSendStreamEvent) => void,
  ) => Promise<void>;
};

export type OpenAiChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: { name: string; arguments: string };
  }>;
  tool_call_id?: string;
};

export type OpenAiToolCall = {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
};

export type ToolExecutionResult = {
  toolName: string;
  payload: unknown;
  citations: CitationSeed[];
};

export type CitationSeed = {
  sourcePath: string;
  chunkId: string;
  score: number;
  chunkTextPreview: string;
  startOffset?: number;
  endOffset?: number;
};

export type RetrievalToolOutput =
  | { kind: "search"; data: RetrievalDebugResult }
  | { kind: "source_chunk_info"; data: { sourcePath: string; chunks: RetrievalChunkInfo[] } }
  | { kind: "retrieve_document"; data: { sourcePath: string; chunkCount: number; content: string; chunks: RetrievalResult[] } };
