import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { text, integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { app } from "electron";
import { join, dirname } from "path";
import { mkdirSync } from "fs";
import { randomUUID } from "crypto";
import type { Conversation, Message, AppSettings } from "../../../src/types";
import { DEFAULT_MODEL } from "../../../src/lib/models";

// ── Schema ────────────────────────────────────────────────────────────────────

export const conversationsTable = sqliteTable("conversations", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messagesTable = sqliteTable("messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  role: text("role").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const settingsTable = sqliteTable("settings", {
  id: text("id").primaryKey().default("app"),
  defaultModel: text("default_model").notNull().default(DEFAULT_MODEL),
  theme: text("theme").notNull().default("dark"),
  onboardingComplete: integer("onboarding_complete", { mode: "boolean" }).notNull().default(false),
  lastConversationId: text("last_conversation_id"),
});

// ── Init ──────────────────────────────────────────────────────────────────────

let db: ReturnType<typeof drizzle>;
let _dbReady = false;
let _dbInitError: string | null = null;

export function isDatabaseReady(): boolean {
  return _dbReady;
}

export function getDbInitError(): string | null {
  return _dbInitError;
}

export function initDatabase(): void {
  _dbInitError = null;
  const dbPath = join(app.getPath("userData"), "ghchat.db");
  try {
    // Ensure the directory exists before opening the DB — app.getPath("userData")
    // is guaranteed to exist on most platforms, but mkdirSync is a safe guard
    // for edge cases (e.g. first-run on a fresh system, unusual userData paths).
    mkdirSync(dirname(dbPath), { recursive: true });
    console.log("[db] opening database at:", dbPath);

    const sqlite = new Database(dbPath);

    sqlite.pragma("journal_mode = WAL");

    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS settings (
        id TEXT PRIMARY KEY DEFAULT 'app',
        default_model TEXT NOT NULL DEFAULT '${DEFAULT_MODEL}',
        theme TEXT NOT NULL DEFAULT 'dark',
        onboarding_complete INTEGER NOT NULL DEFAULT 0,
        last_conversation_id TEXT
      );
      INSERT OR IGNORE INTO settings (id, default_model, theme, onboarding_complete, last_conversation_id) VALUES ('app', '${DEFAULT_MODEL}', 'dark', 0, NULL);
    `);

    // Migrate existing installations: add columns if they don't exist yet
    const existingCols = sqlite
      .prepare("PRAGMA table_info(settings)")
      .all()
      .map((c: Record<string, unknown>) => c["name"] as string);
    if (!existingCols.includes("onboarding_complete")) {
      sqlite.exec("ALTER TABLE settings ADD COLUMN onboarding_complete INTEGER NOT NULL DEFAULT 0");
    }
    if (!existingCols.includes("last_conversation_id")) {
      sqlite.exec("ALTER TABLE settings ADD COLUMN last_conversation_id TEXT");
    }

    db = drizzle(sqlite);
    _dbReady = true;
    console.log("[db] initialized successfully");
  } catch (err) {
    _dbInitError = err instanceof Error ? err.message : String(err);
    console.error("[db] initialization failed — path:", dbPath, "error:", err);
    throw err;
  }
}

function getDb() {
  if (!db) throw new Error("Database not initialized");
  return db;
}

// ── Conversations ─────────────────────────────────────────────────────────────

export function listConversations(): Conversation[] {
  const rows = getDb()
    .select()
    .from(conversationsTable)
    .orderBy(conversationsTable.updatedAt)
    .all();
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  })).reverse();
}

export function createConversation(title = "New conversation"): Conversation {
  const now = Date.now();
  const id = randomUUID();
  getDb().insert(conversationsTable).values({ id, title, createdAt: now, updatedAt: now }).run();
  return { id, title, createdAt: now, updatedAt: now };
}

export function renameConversation(id: string, title: string): void {
  getDb()
    .update(conversationsTable)
    .set({ title, updatedAt: Date.now() })
    .where(eq(conversationsTable.id, id))
    .run();
}

export function deleteConversation(id: string): void {
  getDb().delete(messagesTable).where(eq(messagesTable.conversationId, id)).run();
  getDb().delete(conversationsTable).where(eq(conversationsTable.id, id)).run();
}

// ── Messages ──────────────────────────────────────────────────────────────────

export function listMessages(conversationId: string): Message[] {
  const rows = getDb()
    .select()
    .from(messagesTable)
    .where(eq(messagesTable.conversationId, conversationId))
    .orderBy(messagesTable.createdAt)
    .all();
  return rows.map((r) => ({
    id: r.id,
    conversationId: r.conversationId,
    role: r.role as Message["role"],
    content: r.content,
    createdAt: r.createdAt,
  }));
}

export function appendMessage({
  conversationId,
  role,
  content,
}: {
  conversationId: string;
  role: string;
  content: string;
}): Message {
  const id = randomUUID();
  const createdAt = Date.now();
  getDb()
    .insert(messagesTable)
    .values({ id, conversationId, role, content, createdAt })
    .run();
  // Update conversation updatedAt
  getDb()
    .update(conversationsTable)
    .set({ updatedAt: createdAt })
    .where(eq(conversationsTable.id, conversationId))
    .run();
  return { id, conversationId, role: role as Message["role"], content, createdAt };
}

export function deleteMessage(id: string): void {
  getDb().delete(messagesTable).where(eq(messagesTable.id, id)).run();
}

// ── Settings ──────────────────────────────────────────────────────────────────

export function getSettings(): AppSettings {
  const row = getDb().select().from(settingsTable).where(eq(settingsTable.id, "app")).get();
  return {
    defaultModel: row?.defaultModel ?? DEFAULT_MODEL,
    theme: (row?.theme ?? "dark") as AppSettings["theme"],
    onboardingComplete: row?.onboardingComplete ?? false,
    lastConversationId: row?.lastConversationId ?? null,
  };
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  getDb()
    .update(settingsTable)
    .set({
      ...(partial.defaultModel !== undefined && { defaultModel: partial.defaultModel }),
      ...(partial.theme !== undefined && { theme: partial.theme }),
      ...(partial.onboardingComplete !== undefined && { onboardingComplete: partial.onboardingComplete }),
      ...(partial.lastConversationId !== undefined && { lastConversationId: partial.lastConversationId }),
    })
    .where(eq(settingsTable.id, "app"))
    .run();
  return getSettings();
}

export function clearAllData(): void {
  getDb().delete(messagesTable).run();
  getDb().delete(conversationsTable).run();
  getDb()
    .update(settingsTable)
    .set({ onboardingComplete: false, lastConversationId: null })
    .where(eq(settingsTable.id, "app"))
    .run();
}
