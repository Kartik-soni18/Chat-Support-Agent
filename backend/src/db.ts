import Database from "better-sqlite3";
import type { Database as DatabaseType } from "better-sqlite3";
import { config } from "./config.js";

const db: DatabaseType = new Database(config.DB_PATH);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS conversations (
    id TEXT PRIMARY KEY,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    client_message_id TEXT,
    sender TEXT NOT NULL CHECK(sender IN ('user', 'ai')),
    text TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
`);

// Existing deployments may already have the original messages table. Keep this
// migration here so retries become idempotent without requiring a manual reset.
const messageColumns = db.prepare("PRAGMA table_info(messages)").all() as Array<{ name: string }>;
if (!messageColumns.some((column) => column.name === "client_message_id")) {
  db.exec("ALTER TABLE messages ADD COLUMN client_message_id TEXT");
}

db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_client_message_id
  ON messages(client_message_id)
  WHERE client_message_id IS NOT NULL;
`);

export { db };
