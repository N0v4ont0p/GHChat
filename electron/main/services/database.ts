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

/** One-liner describing the runtime environment — useful in every error/log path. */
function dbEnvInfo(): string {
  return (
    `electron ${process.versions.electron}, modules ${process.versions.modules}, ` +
    `${process.platform}/${process.arch}`
  );
}

/** Extract a human-readable message from any thrown value. */
function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function isDatabaseReady(): boolean {
  return _dbReady;
}

export function getDbInitError(): string | null {
  return _dbInitError;
}

export function initDatabase(): void {
  _dbInitError = null;
  const userData = app.getPath("userData");
  const dbPath = join(userData, "ghchat.db");

  console.log(
    "[db] init — platform:", process.platform,
    "arch:", process.arch,
    "electron:", process.versions.electron,
    "node:", process.versions.node,
    "modules:", process.versions.modules,
    "userData:", userData,
    "dbPath:", dbPath,
  );

  try {
    // Ensure the directory exists before opening the DB — app.getPath("userData")
    // is guaranteed to exist on most platforms, but mkdirSync is a safe guard
    // for edge cases (e.g. first-run on a fresh system, unusual userData paths).
    mkdirSync(dirname(dbPath), { recursive: true });
    console.log("[db] opening better-sqlite3 database…");

    let sqlite: InstanceType<typeof Database>;
    try {
      sqlite = new Database(dbPath);
    } catch (openErr) {
      // Augment the error with env context to make native ABI / arch issues
      // immediately obvious in the log without having to correlate other lines.
      throw new Error(
        `better-sqlite3 failed to open "${dbPath}" (${dbEnvInfo()}): ${errMsg(openErr)}`,
        { cause: openErr },
      );
    }
    console.log("[db] file opened — applying WAL pragma…");

    sqlite.pragma("journal_mode = WAL");
    console.log("[db] WAL enabled — running schema creation…");

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
    console.log("[db] schema applied — checking migrations…");

    // Migrate existing installations: add columns if they don't exist yet.
    // NOTE: SQLite < 3.37.0 forbids ADD COLUMN … NOT NULL even with a DEFAULT,
    // so migration statements deliberately omit NOT NULL.  getSettings() already
    // coerces NULL → false / null via ?? operators, so this is safe.
    const existingCols = sqlite
      .prepare("PRAGMA table_info(settings)")
      .all()
      .map((c: Record<string, unknown>) => c["name"] as string);
    console.log("[db] existing settings columns before migration:", existingCols);

    if (!existingCols.includes("onboarding_complete")) {
      console.log("[db] migration: adding onboarding_complete column…");
      try {
        sqlite.exec("ALTER TABLE settings ADD COLUMN onboarding_complete INTEGER DEFAULT 0");
        // Backfill NULLs for pre-existing rows (older SQLite does not apply
        // the DEFAULT to existing rows the way 3.37+ does).
        sqlite.exec("UPDATE settings SET onboarding_complete = 0 WHERE onboarding_complete IS NULL");
        console.log("[db] migration: onboarding_complete added successfully");
      } catch (err) {
        throw new Error(
          `Migration failed: could not add onboarding_complete — ${errMsg(err)}`,
          { cause: err },
        );
      }
    } else {
      console.log("[db] migration: onboarding_complete already present, skipping");
    }

    if (!existingCols.includes("last_conversation_id")) {
      console.log("[db] migration: adding last_conversation_id column…");
      try {
        sqlite.exec("ALTER TABLE settings ADD COLUMN last_conversation_id TEXT");
        console.log("[db] migration: last_conversation_id added successfully");
      } catch (err) {
        throw new Error(
          `Migration failed: could not add last_conversation_id — ${errMsg(err)}`,
          { cause: err },
        );
      }
    } else {
      console.log("[db] migration: last_conversation_id already present, skipping");
    }

    db = drizzle(sqlite);
    _dbReady = true;
    console.log("[db] initialized successfully");
  } catch (err) {
    _dbInitError = errMsg(err);
    console.error(
      `[db] initialization FAILED (${dbEnvInfo()}) — path: ${dbPath}`,
      "\n[db] error:", err,
      "\n[db] hint: if the error mentions 'NODE_MODULE_VERSION' or 'invalid ELF' run: pnpm run rebuild:native",
    );
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
