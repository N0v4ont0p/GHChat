import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { text, integer, sqliteTable } from "drizzle-orm/sqlite-core";
import { eq } from "drizzle-orm";
import { app } from "electron";
import { join, dirname } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from "fs";
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

// ── Schema versioning ─────────────────────────────────────────────────────────
// Increment SCHEMA_VERSION and add a new numbered migration block whenever the
// DB schema changes.  Migrations are applied in ascending order; each step is
// guarded by the SQLite `user_version` PRAGMA so it only runs once.
//
//  v1 — added onboarding_complete
//  v2 — added last_conversation_id
//
const SCHEMA_VERSION = 2;

// ── Init ──────────────────────────────────────────────────────────────────────

let db: ReturnType<typeof drizzle>;
let sqliteDb: SqlJsDatabase;
let _dbPath: string;
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

/**
 * Persist the in-memory SQLite database to disk atomically.
 * Uses a write-to-tmp-then-rename pattern to avoid partial writes.
 */
function flushDb(): void {
  if (!sqliteDb || !_dbReady || !_dbPath) {
    console.warn("[db] flushDb() called but database is not ready — skipping persist");
    return;
  }
  const data = sqliteDb.export();
  const tmp = _dbPath + ".tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, _dbPath);
}

/**
 * Resolve the path to the sql.js WASM file.
 *
 * In development the file lives in node_modules/sql.js/dist/.
 * In a packaged app it is placed outside the asar archive via
 * electron-builder's asarUnpack rule so it can be read from the filesystem.
 */
function locateSqlJsWasm(file: string): string {
  if (app.isPackaged) {
    return join(
      process.resourcesPath,
      "app.asar.unpacked",
      "node_modules",
      "sql.js",
      "dist",
      file,
    );
  }
  // app.getAppPath() returns the project root in development mode.
  return join(app.getAppPath(), "node_modules", "sql.js", "dist", file);
}

export async function initDatabase(): Promise<void> {
  _dbInitError = null;
  const userData = app.getPath("userData");
  _dbPath = join(userData, "ghchat.db");

  console.log(
    "[db] init — platform:", process.platform,
    "arch:", process.arch,
    "electron:", process.versions.electron,
    "node:", process.versions.node,
    "modules:", process.versions.modules,
    "userData:", userData,
    "dbPath:", _dbPath,
  );

  try {
    mkdirSync(dirname(_dbPath), { recursive: true });

    console.log("[db] loading sql.js (WASM-based SQLite, no native compilation)…");
    const SQL = await initSqlJs({ locateFile: locateSqlJsWasm });

    if (existsSync(_dbPath)) {
      console.log("[db] loading existing database from", _dbPath);
      sqliteDb = new SQL.Database(readFileSync(_dbPath));
    } else {
      console.log("[db] creating new database at", _dbPath);
      sqliteDb = new SQL.Database();
    }
    console.log("[db] database opened — running schema creation…");

    sqliteDb.exec(`
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
    console.log("[db] schema creation done — checking migration version…");

    // ── Schema migrations ────────────────────────────────────────────────────
    // `PRAGMA user_version` is a free integer stored in the DB header.  We use
    // it to track which migrations have already run so each migration is applied
    // exactly once, even if initDatabase() is called again (e.g. after a crash
    // and restart).  Fresh installs start at user_version=0; migrations are
    // applied sequentially up to SCHEMA_VERSION.

    /** Run a single-row PRAGMA and return its value under the given column. */
    function pragmaValue<T>(sql: string, col: string): T {
      const stmt = sqliteDb.prepare(sql);
      stmt.step();
      const val = (stmt.getAsObject() as Record<string, unknown>)[col] as T;
      stmt.free();
      return val;
    }

    /** Return the column names for a table. */
    function tableColumns(table: string): string[] {
      const stmt = sqliteDb.prepare(`PRAGMA table_info(${table})`);
      const cols: string[] = [];
      while (stmt.step()) {
        cols.push((stmt.getAsObject() as { name: string }).name);
      }
      stmt.free();
      return cols;
    }

    const diskVersion = pragmaValue<number>("PRAGMA user_version", "user_version");
    console.log(`[db] schema version on disk: ${diskVersion} (target: ${SCHEMA_VERSION})`);

    // Warn on downgrade — the app may still work, but the schema may have
    // columns that this version does not know about.
    if (diskVersion > SCHEMA_VERSION) {
      console.warn(
        `[db] WARNING: DB schema version (${diskVersion}) is newer than this build (${SCHEMA_VERSION}). ` +
        "The app may have been downgraded. Some features may not work correctly.",
      );
    }

    // v1 — add onboarding_complete
    if (diskVersion < 1) {
      console.log("[db] migration v1: ensuring onboarding_complete column…");
      try {
        const cols = tableColumns("settings");
        console.log("[db] migration v1: existing settings columns:", cols);
        sqliteDb.exec("BEGIN");
        if (!cols.includes("onboarding_complete")) {
          // NOTE: NOT NULL is intentionally omitted here.  SQLite < 3.37.0
          // forbids ADD COLUMN … NOT NULL even when a DEFAULT is provided.
          // getSettings() coerces NULL → false via the ?? operator, so
          // the missing NOT NULL constraint has no observable impact.
          sqliteDb.run("ALTER TABLE settings ADD COLUMN onboarding_complete INTEGER DEFAULT 0");
          sqliteDb.run("UPDATE settings SET onboarding_complete = 0 WHERE onboarding_complete IS NULL");
          console.log("[db] migration v1: onboarding_complete column added and backfilled");
        } else {
          console.log("[db] migration v1: onboarding_complete already present");
        }
        sqliteDb.run("PRAGMA user_version = 1");
        sqliteDb.exec("COMMIT");
        console.log("[db] migration v1: complete");
      } catch (err) {
        sqliteDb.exec("ROLLBACK");
        throw new Error(`Schema migration to v1 failed — ${errMsg(err)}`, { cause: err });
      }
    }

    // v2 — add last_conversation_id
    if (diskVersion < 2) {
      console.log("[db] migration v2: ensuring last_conversation_id column…");
      try {
        const cols = tableColumns("settings");
        sqliteDb.exec("BEGIN");
        if (!cols.includes("last_conversation_id")) {
          sqliteDb.run("ALTER TABLE settings ADD COLUMN last_conversation_id TEXT");
          console.log("[db] migration v2: last_conversation_id column added");
        } else {
          console.log("[db] migration v2: last_conversation_id already present");
        }
        sqliteDb.run("PRAGMA user_version = 2");
        sqliteDb.exec("COMMIT");
        console.log("[db] migration v2: complete");
      } catch (err) {
        sqliteDb.exec("ROLLBACK");
        throw new Error(`Schema migration to v2 failed — ${errMsg(err)}`, { cause: err });
      }
    }

    if (diskVersion >= SCHEMA_VERSION) {
      console.log(`[db] schema is up-to-date at v${SCHEMA_VERSION}, no migrations needed`);
    } else {
      console.log(`[db] schema upgraded from v${diskVersion} to v${SCHEMA_VERSION} — all migration steps complete`);
    }

    db = drizzle(sqliteDb);
    _dbReady = true;

    // Persist the freshly initialised/migrated database immediately.
    flushDb();
    console.log("[db] initialized successfully");
  } catch (err) {
    _dbInitError = errMsg(err);
    console.error(
      `[db] initialization FAILED (${dbEnvInfo()}) — path: ${_dbPath}`,
      "\n[db] error:", err,
    );
    throw err;
  }
}

function getDb() {
  if (!db) {
    const why = _dbInitError ?? "initDatabase() was not called";
    throw new Error(`Database not initialized: ${why}`);
  }
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
  flushDb();
  return { id, title, createdAt: now, updatedAt: now };
}

export function renameConversation(id: string, title: string): void {
  getDb()
    .update(conversationsTable)
    .set({ title, updatedAt: Date.now() })
    .where(eq(conversationsTable.id, id))
    .run();
  flushDb();
}

export function deleteConversation(id: string): void {
  getDb().delete(messagesTable).where(eq(messagesTable.conversationId, id)).run();
  getDb().delete(conversationsTable).where(eq(conversationsTable.id, id)).run();
  flushDb();
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
  flushDb();
  return { id, conversationId, role: role as Message["role"], content, createdAt };
}

export function deleteMessage(id: string): void {
  getDb().delete(messagesTable).where(eq(messagesTable.id, id)).run();
  flushDb();
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
  flushDb();
  return getSettings();
}

export function clearAllData(): void {
  getDb().delete(messagesTable).run();
  getDb().delete(conversationsTable).run();
  // Ensure the settings row exists before updating it (defensive guard in case
  // it was deleted outside normal code paths).
  getDb()
    .insert(settingsTable)
    .values({ id: "app", defaultModel: DEFAULT_MODEL, theme: "dark", onboardingComplete: false, lastConversationId: null })
    .onConflictDoNothing()
    .run();
  getDb()
    .update(settingsTable)
    .set({ onboardingComplete: false, lastConversationId: null })
    .where(eq(settingsTable.id, "app"))
    .run();
  flushDb();
}

