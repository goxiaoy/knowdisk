import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { Database } from "bun:sqlite";
import type {
  ChatCitation,
  ChatMessage,
  ChatMessageStatus,
  ChatRepository,
  ChatSession,
  NewChatCitation,
  NewChatMessage,
} from "./chat.repository.types";

export function createChatRepository(opts: { dbPath: string }): ChatRepository {
  mkdirSync(dirname(opts.dbPath), { recursive: true });
  const db = new Database(opts.dbPath, { create: true });
  db.exec("PRAGMA foreign_keys = ON");
  migrate(db);

  return {
    close() {
      db.close();
    },
    createSession(input: { title: string }): ChatSession {
      const now = Date.now();
      const id = randomUUID();
      db.query(
        `INSERT INTO chat_sessions (id, title, created_at, updated_at, last_message_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(id, input.title, now, now, now);
      return {
        id,
        title: input.title,
        createdAt: now,
        updatedAt: now,
        lastMessageAt: now,
      };
    },
    renameSession(sessionId: string, title: string) {
      db.query("UPDATE chat_sessions SET title = ?, updated_at = ? WHERE id = ?").run(
        title,
        Date.now(),
        sessionId,
      );
    },
    deleteSession(sessionId: string) {
      db.query("DELETE FROM chat_sessions WHERE id = ?").run(sessionId);
    },
    listSessions(): ChatSession[] {
      return db
        .query(
          `SELECT
            id,
            title,
            created_at AS createdAt,
            updated_at AS updatedAt,
            last_message_at AS lastMessageAt
          FROM chat_sessions
          ORDER BY last_message_at DESC, created_at DESC`,
        )
        .all() as ChatSession[];
    },
    createMessage(input: NewChatMessage): ChatMessage {
      const now = Date.now();
      const id = randomUUID();
      db.query(
        `INSERT INTO chat_messages (
          id, session_id, role, content, status, model, token_in, token_out, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id,
        input.sessionId,
        input.role,
        input.content,
        input.status,
        input.model ?? null,
        input.tokenIn ?? null,
        input.tokenOut ?? null,
        now,
      );
      db.query("UPDATE chat_sessions SET updated_at = ?, last_message_at = ? WHERE id = ?").run(
        now,
        now,
        input.sessionId,
      );
      return {
        id,
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        status: input.status,
        model: input.model,
        tokenIn: input.tokenIn,
        tokenOut: input.tokenOut,
        createdAt: now,
      };
    },
    updateMessageContent(messageId: string, content: string) {
      db.query("UPDATE chat_messages SET content = ? WHERE id = ?").run(content, messageId);
    },
    updateMessageStatus(messageId: string, status: ChatMessageStatus) {
      db.query("UPDATE chat_messages SET status = ? WHERE id = ?").run(status, messageId);
    },
    listMessages(sessionId: string): ChatMessage[] {
      return db
        .query(
          `SELECT
            id,
            session_id AS sessionId,
            role,
            content,
            status,
            model,
            token_in AS tokenIn,
            token_out AS tokenOut,
            created_at AS createdAt
          FROM chat_messages
          WHERE session_id = ?
          ORDER BY created_at ASC, rowid ASC`,
        )
        .all(sessionId) as ChatMessage[];
    },
    replaceCitations(messageId: string, citations: NewChatCitation[]) {
      const deleteStmt = db.query("DELETE FROM chat_message_citations WHERE message_id = ?");
      const insertStmt = db.query(
        `INSERT INTO chat_message_citations (
          id, message_id, source_path, chunk_id, score, chunk_text_preview, start_offset, end_offset
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      const tx = db.transaction((input: NewChatCitation[]) => {
        deleteStmt.run(messageId);
        for (const citation of input) {
          insertStmt.run(
            randomUUID(),
            messageId,
            citation.sourcePath,
            citation.chunkId,
            citation.score,
            citation.chunkTextPreview,
            citation.startOffset ?? null,
            citation.endOffset ?? null,
          );
        }
      });
      tx(citations);
    },
    listCitations(messageId: string): ChatCitation[] {
      return db
        .query(
          `SELECT
            id,
            message_id AS messageId,
            source_path AS sourcePath,
            chunk_id AS chunkId,
            score,
            chunk_text_preview AS chunkTextPreview,
            start_offset AS startOffset,
            end_offset AS endOffset
          FROM chat_message_citations
          WHERE message_id = ?
          ORDER BY rowid ASC`,
        )
        .all(messageId) as ChatCitation[];
    },
  };
}

function migrate(db: Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS chat_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_message_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      status TEXT NOT NULL,
      model TEXT,
      token_in INTEGER,
      token_out INTEGER,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(session_id) REFERENCES chat_sessions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS chat_message_citations (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      source_path TEXT NOT NULL,
      chunk_id TEXT NOT NULL,
      score REAL NOT NULL,
      chunk_text_preview TEXT NOT NULL,
      start_offset INTEGER,
      end_offset INTEGER,
      FOREIGN KEY(message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_sessions_last_message_at ON chat_sessions(last_message_at DESC);
    CREATE INDEX IF NOT EXISTS idx_chat_messages_session_id_created_at ON chat_messages(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_chat_citations_message_id ON chat_message_citations(message_id);
  `);
}
