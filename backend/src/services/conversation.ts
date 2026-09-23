import { v4 as uuidv4 } from "uuid";
import { db } from "../db.js";
import type { ChatMessage, Conversation } from "../types.js";

export function createConversation(): string {
  const id = uuidv4();
  const stmt = db.prepare(
    "INSERT INTO conversations (id) VALUES (?)"
  );
  stmt.run(id);
  console.log(`[DB] Created conversation | sessionId=${id}`);
  return id;
}

export function getConversation(id: string): Conversation | null {
  const stmt = db.prepare(
    "SELECT id, created_at as createdAt, updated_at as updatedAt FROM conversations WHERE id = ?"
  );
  const row = stmt.get(id) as { id: string; createdAt: string; updatedAt: string } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

export function addMessage(
  conversationId: string,
  sender: "user" | "ai",
  text: string,
  clientMessageId?: string
): ChatMessage {
  const insertMsg = db.prepare(
    "INSERT INTO messages (conversation_id, client_message_id, sender, text) VALUES (?, ?, ?, ?)"
  );
  const updateConv = db.prepare(
    "UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ?"
  );

  const result = db.transaction(() => {
    const msgResult = insertMsg.run(conversationId, clientMessageId ?? null, sender, text);
    updateConv.run(conversationId);
    return msgResult;
  })();

  const messageId = Number(result.lastInsertRowid);
  console.log(`[DB] Saved message | msgId=${messageId} | sessionId=${conversationId} | sender=${sender} | len=${text.length}`);

  const selectStmt = db.prepare(
    "SELECT id, sender, text, created_at as timestamp FROM messages WHERE id = ?"
  );
  const row = selectStmt.get(messageId) as {
    id: number;
    sender: "user" | "ai";
    text: string;
    timestamp: string;
  };

  return {
    id: row.id,
    sender: row.sender,
    text: row.text,
    timestamp: row.timestamp,
  };
}

export function getMessageByClientMessageId(
  conversationId: string,
  clientMessageId: string
): ChatMessage | null {
  const stmt = db.prepare(
    `SELECT id, sender, text, created_at as timestamp
     FROM messages
     WHERE conversation_id = ? AND client_message_id = ?`
  );
  const row = stmt.get(conversationId, clientMessageId) as ChatMessage | undefined;
  return row ?? null;
}

export function getMessagesBeforeMessage(
  conversationId: string,
  messageId: number
): ChatMessage[] {
  const stmt = db.prepare(
    `SELECT id, sender, text, created_at as timestamp
     FROM messages
     WHERE conversation_id = ? AND id < ?
     ORDER BY id ASC`
  );
  return stmt.all(conversationId, messageId) as ChatMessage[];
}

export function getReplyAfterMessage(
  conversationId: string,
  messageId: number
): ChatMessage | null {
  const stmt = db.prepare(
    `SELECT id, sender, text, created_at as timestamp
     FROM messages
     WHERE conversation_id = ? AND id > ? AND sender = 'ai'
     ORDER BY id ASC
     LIMIT 1`
  );
  const row = stmt.get(conversationId, messageId) as ChatMessage | undefined;
  return row ?? null;
}

export function getMessages(conversationId: string): ChatMessage[] {
  const stmt = db.prepare(
    "SELECT id, sender, text, created_at as timestamp FROM messages WHERE conversation_id = ? ORDER BY created_at ASC"
  );
  const rows = stmt.all(conversationId) as Array<{
    id: number;
    sender: "user" | "ai";
    text: string;
    timestamp: string;
  }>;

  console.log(`[DB] Loaded ${rows.length} messages | sessionId=${conversationId}`);

  return rows.map((row) => ({
    id: row.id,
    sender: row.sender,
    text: row.text,
    timestamp: row.timestamp,
  }));
}

export function conversationExists(id: string): boolean {
  const stmt = db.prepare(
    "SELECT 1 FROM conversations WHERE id = ?"
  );
  const row = stmt.get(id);
  return row !== undefined;
}
