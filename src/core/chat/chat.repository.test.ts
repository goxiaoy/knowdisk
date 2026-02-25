import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createChatRepository } from "./chat.repository";

describe("chat.repository", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "knowdisk-chat-repo-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  test("creates session, messages, and citations", () => {
    const repo = createChatRepository({ dbPath: join(dir, "chat.db") });

    const session = repo.createSession({ title: "New Chat" });
    const user = repo.createMessage({
      sessionId: session.id,
      role: "user",
      content: "hello",
      status: "done",
    });
    const assistant = repo.createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "world",
      status: "done",
      model: "gpt-4.1-mini",
    });

    repo.replaceCitations(assistant.id, [
      {
        sourcePath: "/docs/a.md",
        chunkId: "chunk-1",
        score: 0.92,
        chunkTextPreview: "preview",
        startOffset: 10,
        endOffset: 40,
      },
    ]);

    const sessions = repo.listSessions();
    const messages = repo.listMessages(session.id);
    const citations = repo.listCitations(assistant.id);

    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe(session.id);
    expect(messages.map((m) => m.id)).toEqual([user.id, assistant.id]);
    expect(citations).toHaveLength(1);
    expect(citations[0]?.sourcePath).toBe("/docs/a.md");

    repo.close();
  });

  test("deleteSession cascades messages and citations", () => {
    const repo = createChatRepository({ dbPath: join(dir, "chat.db") });
    const session = repo.createSession({ title: "Cascade" });
    const assistant = repo.createMessage({
      sessionId: session.id,
      role: "assistant",
      content: "answer",
      status: "done",
    });
    repo.replaceCitations(assistant.id, [
      {
        sourcePath: "/docs/b.md",
        chunkId: "chunk-2",
        score: 0.88,
        chunkTextPreview: "b",
      },
    ]);

    repo.deleteSession(session.id);

    expect(repo.listSessions()).toHaveLength(0);
    expect(repo.listMessages(session.id)).toHaveLength(0);
    expect(repo.listCitations(assistant.id)).toHaveLength(0);

    repo.close();
  });
});
