export type ChatRole = "system" | "user" | "assistant" | "tool";
export type ChatMessageStatus = "streaming" | "done" | "error";

export type ChatSession = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  lastMessageAt: number;
};

export type ChatMessage = {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  status: ChatMessageStatus;
  model?: string;
  tokenIn?: number;
  tokenOut?: number;
  createdAt: number;
};

export type ChatCitation = {
  id: string;
  messageId: string;
  sourcePath: string;
  chunkId: string;
  score: number;
  chunkTextPreview: string;
  startOffset?: number;
  endOffset?: number;
};

export type NewChatMessage = {
  sessionId: string;
  role: ChatRole;
  content: string;
  status: ChatMessageStatus;
  model?: string;
  tokenIn?: number;
  tokenOut?: number;
};

export type NewChatCitation = {
  sourcePath: string;
  chunkId: string;
  score: number;
  chunkTextPreview: string;
  startOffset?: number;
  endOffset?: number;
};

export type ChatRepository = {
  close: () => void;
  createSession: (input: { title: string }) => ChatSession;
  renameSession: (sessionId: string, title: string) => void;
  deleteSession: (sessionId: string) => void;
  listSessions: () => ChatSession[];
  createMessage: (input: NewChatMessage) => ChatMessage;
  updateMessageContent: (messageId: string, content: string) => void;
  updateMessageStatus: (messageId: string, status: ChatMessageStatus) => void;
  listMessages: (sessionId: string) => ChatMessage[];
  replaceCitations: (messageId: string, citations: NewChatCitation[]) => void;
  listCitations: (messageId: string) => ChatCitation[];
};
