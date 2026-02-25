import { useEffect, useMemo, useState } from "react";
import type { ChatCitation, ChatMessage, ChatSession } from "../../../core/chat/chat.repository.types";
import {
  createChatSessionInBun,
  deleteChatSessionInBun,
  forceResyncInBun,
  installClaudeMcpInBun,
  listChatMessagesInBun,
  listChatSessionsInBun,
  renameChatSessionInBun,
  startChatStreamInBun,
  stopChatStreamInBun,
} from "../../services/bun.rpc";
import { defaultMainviewConfigService } from "../../services/config.service";
import { RetrievalSearchCard } from "./RetrievalSearchCard";

type MessageWithCitations = ChatMessage & { citations?: ChatCitation[] };

export function HomePage({
  forceResync = forceResyncInBun,
  installClaudeMcp = installClaudeMcpInBun,
  listSessions = listChatSessionsInBun,
  createSession = createChatSessionInBun,
  renameSession = renameChatSessionInBun,
  deleteSession = deleteChatSessionInBun,
  listMessages = listChatMessagesInBun,
  startChat = startChatStreamInBun,
  stopChat = stopChatStreamInBun,
  hasChatApiKey = defaultMainviewConfigService.getConfig().chat.openai.apiKey.trim().length > 0,
}: {
  forceResync?: () => Promise<{ ok: boolean; error?: string } | null>;
  installClaudeMcp?: () => Promise<{ ok: boolean; path?: string; error?: string } | null>;
  listSessions?: () => Promise<ChatSession[] | null>;
  createSession?: (title?: string) => Promise<ChatSession | null>;
  renameSession?: (sessionId: string, title: string) => Promise<boolean>;
  deleteSession?: (sessionId: string) => Promise<boolean>;
  listMessages?: (sessionId: string) => Promise<MessageWithCitations[] | null>;
  startChat?: (input: {
    sessionId: string;
    content: string;
    onChunk: (chunk: string) => void;
  }) => Promise<{ requestId: string; done: Promise<{ message: ChatMessage; citations: ChatCitation[] }> } | null>;
  stopChat?: (requestId: string) => Promise<boolean>;
  hasChatApiKey?: boolean;
}) {
  const [resyncing, setResyncing] = useState(false);
  const [installingClaude, setInstallingClaude] = useState(false);
  const [activity, setActivity] = useState("");
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [messages, setMessages] = useState<MessageWithCitations[]>([]);
  const [prompt, setPrompt] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [streamRequestId, setStreamRequestId] = useState("");
  const [showDebug, setShowDebug] = useState(false);

  const missingApiKey = !hasChatApiKey;

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rows = await listSessions();
      if (cancelled) {
        return;
      }
      const next = rows ?? [];
      setSessions(next);
      if (next.length > 0) {
        const first = next[0]!;
        setActiveSessionId(first.id);
        const loaded = await listMessages(first.id);
        if (!cancelled) {
          setMessages(loaded ?? []);
        }
        return;
      }
      const created = await createSession("New Chat");
      if (!created || cancelled) {
        return;
      }
      setSessions([created]);
      setActiveSessionId(created.id);
      setMessages([]);
    })();
    return () => {
      cancelled = true;
    };
  }, [createSession, listMessages, listSessions]);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const onForceResync = async () => {
    setResyncing(true);
    setActivity("");
    const result = await forceResync();
    if (!result) {
      setActivity("Force resync request failed.");
      setResyncing(false);
      return;
    }
    setActivity(result.ok ? "Force resync started." : `Force resync failed: ${result.error ?? "unknown error"}`);
    setResyncing(false);
  };

  const onInstallClaude = async () => {
    setInstallingClaude(true);
    setActivity("");
    const result = await installClaudeMcp();
    if (!result) {
      setActivity("Configure Claude MCP request failed.");
      setInstallingClaude(false);
      return;
    }
    setActivity(
      result.ok
        ? `Claude MCP configured: ${result.path ?? "updated"}`
        : `Configure Claude MCP failed: ${result.error ?? "unknown error"}`,
    );
    setInstallingClaude(false);
  };

  const switchSession = async (sessionId: string) => {
    if (streamRequestId) {
      await stopChat(streamRequestId);
      setStreaming(false);
      setStreamRequestId("");
    }
    setActiveSessionId(sessionId);
    const loaded = await listMessages(sessionId);
    setMessages(loaded ?? []);
  };

  const createNewSession = async () => {
    const created = await createSession("New Chat");
    if (!created) {
      return;
    }
    setSessions((prev) => [created, ...prev]);
    setActiveSessionId(created.id);
    setMessages([]);
  };

  const removeSession = async (sessionId: string) => {
    if (!globalThis.confirm("Delete this chat session?")) {
      return;
    }
    const ok = await deleteSession(sessionId);
    if (!ok) {
      setActivity("Delete session failed.");
      return;
    }
    const next = sessions.filter((item) => item.id !== sessionId);
    setSessions(next);
    if (activeSessionId === sessionId) {
      if (next[0]) {
        await switchSession(next[0].id);
      } else {
        setActiveSessionId("");
        setMessages([]);
      }
    }
  };

  const sendPrompt = async () => {
    if (!activeSessionId || streaming) {
      return;
    }
    const content = prompt.trim();
    if (!content) {
      return;
    }

    const tempUser: MessageWithCitations = {
      id: `temp-user-${Date.now()}`,
      sessionId: activeSessionId,
      role: "user",
      content,
      status: "done",
      createdAt: Date.now(),
    };
    const tempAssistant: MessageWithCitations = {
      id: `temp-assistant-${Date.now()}`,
      sessionId: activeSessionId,
      role: "assistant",
      content: "",
      status: "streaming",
      createdAt: Date.now() + 1,
      citations: [],
    };

    setMessages((prev) => [...prev, tempUser, tempAssistant]);
    setPrompt("");
    setStreaming(true);

    const stream = await startChat({
      sessionId: activeSessionId,
      content,
      onChunk(chunk) {
        setMessages((prev) =>
          prev.map((item) =>
            item.id === tempAssistant.id
              ? {
                  ...item,
                  content: `${item.content}${chunk}`,
                }
              : item,
          ),
        );
      },
    });

    if (!stream) {
      setStreaming(false);
      setActivity("Chat request failed.");
      return;
    }

    setStreamRequestId(stream.requestId);
    try {
      const result = await stream.done;
      const loaded = await listMessages(activeSessionId);
      setMessages(loaded ?? []);
      setSessions((prev) => {
        const rows = [...prev];
        const index = rows.findIndex((item) => item.id === activeSessionId);
        if (index < 0) {
          return prev;
        }
        const current = rows[index]!;
        const renamed = current.title === "New Chat" ? content.slice(0, 40) : current.title;
        if (current.title === "New Chat") {
          void renameSession(activeSessionId, renamed);
        }
        rows[index] = {
          ...current,
          title: renamed,
          lastMessageAt: result.message.createdAt,
          updatedAt: result.message.createdAt,
        };
        return rows.sort((a, b) => b.lastMessageAt - a.lastMessageAt);
      });
    } catch (error) {
      setActivity(`Chat failed: ${error instanceof Error ? error.message : String(error)}`);
      const loaded = await listMessages(activeSessionId);
      setMessages(loaded ?? []);
    } finally {
      setStreaming(false);
      setStreamRequestId("");
    }
  };

  const stopCurrentStream = async () => {
    if (!streamRequestId) {
      return;
    }
    await stopChat(streamRequestId);
    setStreaming(false);
    setStreamRequestId("");
  };

  return (
    <section className="min-h-screen bg-[radial-gradient(circle_at_top,#e2e8f0_0%,#f8fafc_45%,#ecfeff_100%)] p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-2xl border border-slate-200 bg-white/90 p-6 shadow-sm backdrop-blur">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-3xl font-semibold tracking-tight text-slate-900">Know Disk Home</h1>
              <p className="mt-1 text-sm text-slate-600">Chat with automatic local retrieval tool-calling</p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                data-testid="home-configure-claude-mcp"
                type="button"
                disabled={installingClaude}
                onClick={() => void onInstallClaude()}
                className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-900 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {installingClaude ? "Configuring Claude..." : "Add MCP To Claude"}
              </button>
              <button
                data-testid="home-force-resync"
                type="button"
                disabled={resyncing}
                onClick={() => void onForceResync()}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {resyncing ? "Force Resync..." : "Force Resync"}
              </button>
            </div>
          </div>
          {activity ? (
            <p className="mt-3 rounded-lg border border-cyan-200 bg-cyan-50 px-3 py-2 text-sm text-cyan-800">{activity}</p>
          ) : null}
        </header>

        {missingApiKey ? (
          <article className="rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-900">
            <h2 className="text-lg font-semibold">Chat API key is missing</h2>
            <p className="mt-2 text-sm">Go to Settings and configure Chat OpenAI API key to start chatting.</p>
          </article>
        ) : (
          <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
            <aside className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-700">Sessions</h2>
                <button
                  data-testid="chat-new-session"
                  type="button"
                  onClick={() => void createNewSession()}
                  className="rounded-md bg-slate-900 px-2 py-1 text-xs font-medium text-white"
                >
                  New
                </button>
              </div>
              <div className="space-y-2">
                {sessions.map((session) => (
                  <div
                    key={session.id}
                    className={`rounded-lg border p-2 ${
                      session.id === activeSessionId ? "border-cyan-300 bg-cyan-50" : "border-slate-200 bg-white"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => void switchSession(session.id)}
                      className="w-full text-left text-sm font-medium text-slate-800"
                    >
                      {session.title}
                    </button>
                    <button
                      type="button"
                      onClick={() => void removeSession(session.id)}
                      className="mt-1 text-xs text-rose-600"
                    >
                      Delete
                    </button>
                  </div>
                ))}
              </div>
            </aside>

            <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 border-b border-slate-200 pb-2">
                <h2 className="text-lg font-semibold text-slate-900">{activeSession?.title ?? "Chat"}</h2>
              </div>
              <div className="max-h-[56vh] space-y-3 overflow-y-auto pr-1">
                {messages.length === 0 ? (
                  <p className="text-sm text-slate-500">Start a conversation.</p>
                ) : (
                  messages.map((message) => (
                    <div key={message.id} className="rounded-xl border border-slate-200 px-3 py-2">
                      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{message.role}</p>
                      <p className="mt-1 whitespace-pre-wrap text-sm text-slate-800">{message.content}</p>
                      {message.role === "assistant" && (message.citations?.length ?? 0) > 0 ? (
                        <details className="mt-2 rounded border border-cyan-100 bg-cyan-50/60 p-2">
                          <summary className="cursor-pointer text-xs font-medium text-cyan-800">
                            Citations ({message.citations?.length ?? 0})
                          </summary>
                          <div className="mt-2 space-y-2">
                            {message.citations?.map((citation) => (
                              <div key={citation.id} className="rounded border border-cyan-100 bg-white px-2 py-1">
                                <p className="break-all text-xs font-medium text-slate-800">{citation.sourcePath}</p>
                                <p className="mt-1 text-xs text-slate-600">{citation.chunkTextPreview}</p>
                              </div>
                            ))}
                          </div>
                        </details>
                      ) : null}
                    </div>
                  ))
                )}
              </div>
              <div className="mt-4 flex gap-2">
                <textarea
                  data-testid="chat-composer"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Ask about your local knowledge..."
                  className="min-h-[72px] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm focus:border-cyan-500 focus:outline-none focus:ring-2 focus:ring-cyan-100"
                />
                <div className="flex flex-col gap-2">
                  <button
                    data-testid="chat-send"
                    type="button"
                    disabled={streaming || prompt.trim().length === 0 || !activeSessionId}
                    onClick={() => void sendPrompt()}
                    className="rounded-lg bg-cyan-700 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {streaming ? "Streaming..." : "Send"}
                  </button>
                  {streaming ? (
                    <button
                      data-testid="chat-stop"
                      type="button"
                      onClick={() => void stopCurrentStream()}
                      className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
                    >
                      Stop
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          </div>
        )}

        <article className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
          <button
            type="button"
            onClick={() => setShowDebug((prev) => !prev)}
            className="text-sm font-medium text-slate-700"
          >
            {showDebug ? "Hide" : "Show"} Retrieval Debug Panel
          </button>
          {showDebug ? <div className="mt-4"><RetrievalSearchCard /></div> : null}
        </article>
      </div>
    </section>
  );
}
