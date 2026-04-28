import initSqlJs from "sql.js";
import type { Database as SqlJsDatabase } from "sql.js";
import { drizzle } from "drizzle-orm/sql-js";
import { text, integer, real, sqliteTable } from "drizzle-orm/sqlite-core";
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
  currentMode: text("current_mode").default("online"),
});

// ── Offline tables ─────────────────────────────────────────────────────────────

/**
 * Singleton row tracking the overall offline-mode installation state.
 * Updated as the offline setup state machine advances.
 */
export const offlineInstallationTable = sqliteTable("offline_installation", {
  id: text("id").primaryKey().default("app"),
  /** Current OfflineSetupState value (stored as text). */
  state: text("state").notNull().default("not-installed"),
  /** Absolute path of the offline root resolved at setup time. */
  offlineRoot: text("offline_root"),
  /** Epoch ms when the installation first reached "installed" state. */
  installedAt: integer("installed_at"),
  updatedAt: integer("updated_at").notNull(),
});

/** One row per successfully installed offline model. */
export const offlineModelsTable = sqliteTable("offline_models", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  sizeGb: real("size_gb").notNull(),
  quantization: text("quantization"),
  /** Absolute path to the model file(s) inside the models/ sub-directory. */
  modelPath: text("model_path").notNull(),
  /** Absolute path to the model's JSON manifest inside manifests/. */
  manifestPath: text("manifest_path").notNull(),
  installedAt: integer("installed_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

/** Singleton row for the local inference runtime. */
export const offlineRuntimeTable = sqliteTable("offline_runtime", {
  id: text("id").primaryKey().default("app"),
  version: text("version"),
  /** Absolute path to the runtime binary/bundle inside runtime/. */
  runtimePath: text("runtime_path"),
  installedAt: integer("installed_at"),
  lastHealthCheck: integer("last_health_check"),
  /** Short status string: "ok" | "error" | "unknown". */
  healthStatus: text("health_status"),
  updatedAt: integer("updated_at").notNull(),
});

/**
 * File ownership manifest — one row per file that GHchat manages as part
 * of the offline installation.  Enables precise clean-up and integrity checks.
 */
export const offlineManifestsTable = sqliteTable("offline_manifests", {
  id: text("id").primaryKey(),
  /** "model" | "runtime" | "system" */
  ownerType: text("owner_type").notNull(),
  /** Catalog model ID, "runtime", or "system" */
  ownerId: text("owner_id").notNull(),
  /** Absolute path of the managed file. */
  filePath: text("file_path").notNull(),
  sizeBytes: integer("size_bytes"),
  createdAt: integer("created_at").notNull(),
});

// ── Schema versioning ─────────────────────────────────────────────────────────
// Increment SCHEMA_VERSION and add a new numbered migration block whenever the
// DB schema changes.  Migrations are applied in ascending order; each step is
// guarded by the SQLite `user_version` PRAGMA so it only runs once.
//
//  v1 — added onboarding_complete
//  v2 — added last_conversation_id
//  v3 — added offline_installation, offline_models, offline_runtime,
//        offline_manifests tables
//  v4 — added current_mode to settings
//
const SCHEMA_VERSION = 4;

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
 * In a packaged app, electron-builder copies the WASM via extraResources
 * directly into the Resources directory so it can be read from the filesystem
 * without needing an unpacked asar entry.  The JS wrapper is bundled into
 * out/main/index.js by Vite; only the WASM binary needs a filesystem path.
 */
function locateSqlJsWasm(file: string): string {
  let resolved: string;
  if (app.isPackaged) {
    // extraResources places files directly in the platform Resources directory
    // (e.g. GHchat.app/Contents/Resources/ on macOS).
    resolved = join(process.resourcesPath, file);
  } else {
    // app.getAppPath() returns the project root in development mode.
    resolved = join(app.getAppPath(), "node_modules", "sql.js", "dist", file);
  }
  console.log(
    `[db] locateSqlJsWasm: ${file} → ${resolved} (packaged: ${app.isPackaged})`,
  );
  if (!existsSync(resolved)) {
    const msg =
      `[db] sql.js WASM asset missing: ${resolved}\n` +
      `     resourcesPath=${process.resourcesPath} appPath=${app.getAppPath()}\n` +
      `     Packaged build must include sql-wasm.wasm via electron-builder extraResources.`;
    console.error(msg);
    throw new Error(msg);
  }
  return resolved;
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
        last_conversation_id TEXT,
        current_mode TEXT DEFAULT 'online'
      );
      INSERT OR IGNORE INTO settings (id, default_model, theme, onboarding_complete, last_conversation_id, current_mode) VALUES ('app', '${DEFAULT_MODEL}', 'dark', 0, NULL, 'online');
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

    // v3 — add offline tables (offline_installation, offline_models,
    //       offline_runtime, offline_manifests)
    if (diskVersion < 3) {
      console.log("[db] migration v3: creating offline tables…");
      try {
        sqliteDb.exec("BEGIN");
        sqliteDb.exec(`
          CREATE TABLE IF NOT EXISTS offline_installation (
            id TEXT PRIMARY KEY DEFAULT 'app',
            state TEXT NOT NULL DEFAULT 'not-installed',
            offline_root TEXT,
            installed_at INTEGER,
            updated_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS offline_models (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            size_gb REAL NOT NULL,
            quantization TEXT,
            model_path TEXT NOT NULL,
            manifest_path TEXT NOT NULL,
            installed_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS offline_runtime (
            id TEXT PRIMARY KEY DEFAULT 'app',
            version TEXT,
            runtime_path TEXT,
            installed_at INTEGER,
            last_health_check INTEGER,
            health_status TEXT,
            updated_at INTEGER NOT NULL
          );
          CREATE TABLE IF NOT EXISTS offline_manifests (
            id TEXT PRIMARY KEY,
            owner_type TEXT NOT NULL,
            owner_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            size_bytes INTEGER,
            created_at INTEGER NOT NULL
          );
        `);
        const now = Date.now();
        sqliteDb.run(
          "INSERT OR IGNORE INTO offline_installation (id, state, updated_at) VALUES ('app', 'not-installed', ?)",
          [now],
        );
        sqliteDb.run(
          "INSERT OR IGNORE INTO offline_runtime (id, updated_at) VALUES ('app', ?)",
          [now],
        );
        sqliteDb.run("PRAGMA user_version = 3");
        sqliteDb.exec("COMMIT");
        console.log("[db] migration v3: complete");
      } catch (err) {
        sqliteDb.exec("ROLLBACK");
        throw new Error(`Schema migration to v3 failed — ${errMsg(err)}`, { cause: err });
      }
    }

    // v4 — add current_mode to settings
    if (diskVersion < 4) {
      console.log("[db] migration v4: ensuring current_mode column in settings…");
      try {
        const cols = tableColumns("settings");
        sqliteDb.exec("BEGIN");
        if (!cols.includes("current_mode")) {
          sqliteDb.run("ALTER TABLE settings ADD COLUMN current_mode TEXT DEFAULT 'online'");
          sqliteDb.run("UPDATE settings SET current_mode = 'online' WHERE current_mode IS NULL");
          console.log("[db] migration v4: current_mode column added and backfilled");
        } else {
          console.log("[db] migration v4: current_mode already present");
        }
        sqliteDb.run("PRAGMA user_version = 4");
        sqliteDb.exec("COMMIT");
        console.log("[db] migration v4: complete");
      } catch (err) {
        sqliteDb.exec("ROLLBACK");
        throw new Error(`Schema migration to v4 failed — ${errMsg(err)}`, { cause: err });
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
    currentMode: (row?.currentMode ?? "online") as AppSettings["currentMode"],
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
      ...(partial.currentMode !== undefined && { currentMode: partial.currentMode }),
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

// ── Offline: record types ─────────────────────────────────────────────────────

export interface OfflineInstallationRecord {
  id: string;
  state: string;
  offlineRoot: string | null;
  installedAt: number | null;
  updatedAt: number;
}

export interface OfflineModelRecord {
  id: string;
  name: string;
  sizeGb: number;
  quantization: string | null;
  modelPath: string;
  manifestPath: string;
  installedAt: number;
  updatedAt: number;
}

export interface OfflineRuntimeRecord {
  id: string;
  version: string | null;
  runtimePath: string | null;
  installedAt: number | null;
  lastHealthCheck: number | null;
  healthStatus: string | null;
  updatedAt: number;
}

export interface OfflineManifestRecord {
  id: string;
  ownerType: string;
  ownerId: string;
  filePath: string;
  sizeBytes: number | null;
  createdAt: number;
}

// ── Offline: installation singleton ──────────────────────────────────────────

export function getOfflineInstallation(): OfflineInstallationRecord | null {
  const row = getDb()
    .select()
    .from(offlineInstallationTable)
    .where(eq(offlineInstallationTable.id, "app"))
    .get();
  return row ?? null;
}

export function upsertOfflineInstallation(
  partial: Partial<Pick<OfflineInstallationRecord, "state" | "offlineRoot" | "installedAt">>,
): void {
  const now = Date.now();
  getDb()
    .update(offlineInstallationTable)
    .set({
      ...(partial.state !== undefined && { state: partial.state }),
      ...(partial.offlineRoot !== undefined && { offlineRoot: partial.offlineRoot }),
      ...(partial.installedAt !== undefined && { installedAt: partial.installedAt }),
      updatedAt: now,
    })
    .where(eq(offlineInstallationTable.id, "app"))
    .run();
  flushDb();
}

// ── Offline: models ───────────────────────────────────────────────────────────

export function listOfflineModels(): OfflineModelRecord[] {
  return getDb()
    .select()
    .from(offlineModelsTable)
    .orderBy(offlineModelsTable.installedAt)
    .all()
    .map((r) => ({
      id: r.id,
      name: r.name,
      sizeGb: r.sizeGb,
      quantization: r.quantization ?? null,
      modelPath: r.modelPath,
      manifestPath: r.manifestPath,
      installedAt: r.installedAt,
      updatedAt: r.updatedAt,
    }));
}

export function getOfflineModel(id: string): OfflineModelRecord | null {
  const row = getDb()
    .select()
    .from(offlineModelsTable)
    .where(eq(offlineModelsTable.id, id))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    sizeGb: row.sizeGb,
    quantization: row.quantization ?? null,
    modelPath: row.modelPath,
    manifestPath: row.manifestPath,
    installedAt: row.installedAt,
    updatedAt: row.updatedAt,
  };
}

export function upsertOfflineModel(
  model: Pick<OfflineModelRecord, "id" | "name" | "sizeGb" | "modelPath" | "manifestPath"> &
    Partial<Pick<OfflineModelRecord, "quantization">>,
): OfflineModelRecord {
  const now = Date.now();
  const values = {
    id: model.id,
    name: model.name,
    sizeGb: model.sizeGb,
    quantization: model.quantization ?? null,
    modelPath: model.modelPath,
    manifestPath: model.manifestPath,
    installedAt: now,
    updatedAt: now,
  };
  getDb()
    .insert(offlineModelsTable)
    .values(values)
    .onConflictDoUpdate({
      target: offlineModelsTable.id,
      set: {
        name: model.name,
        sizeGb: model.sizeGb,
        quantization: model.quantization ?? null,
        modelPath: model.modelPath,
        manifestPath: model.manifestPath,
        updatedAt: now,
      },
    })
    .run();
  flushDb();
  return getOfflineModel(model.id)!;
}

export function deleteOfflineModel(id: string): void {
  // Remove all manifest entries owned by this model first.
  getDb()
    .delete(offlineManifestsTable)
    .where(eq(offlineManifestsTable.ownerId, id))
    .run();
  getDb().delete(offlineModelsTable).where(eq(offlineModelsTable.id, id)).run();
  flushDb();
}

// ── Offline: runtime singleton ────────────────────────────────────────────────

export function getOfflineRuntime(): OfflineRuntimeRecord | null {
  const row = getDb()
    .select()
    .from(offlineRuntimeTable)
    .where(eq(offlineRuntimeTable.id, "app"))
    .get();
  return row ?? null;
}

export function upsertOfflineRuntime(
  partial: Partial<
    Pick<
      OfflineRuntimeRecord,
      "version" | "runtimePath" | "installedAt" | "lastHealthCheck" | "healthStatus"
    >
  >,
): void {
  const now = Date.now();
  getDb()
    .update(offlineRuntimeTable)
    .set({
      ...(partial.version !== undefined && { version: partial.version }),
      ...(partial.runtimePath !== undefined && { runtimePath: partial.runtimePath }),
      ...(partial.installedAt !== undefined && { installedAt: partial.installedAt }),
      ...(partial.lastHealthCheck !== undefined && { lastHealthCheck: partial.lastHealthCheck }),
      ...(partial.healthStatus !== undefined && { healthStatus: partial.healthStatus }),
      updatedAt: now,
    })
    .where(eq(offlineRuntimeTable.id, "app"))
    .run();
  flushDb();
}

// ── Offline: manifests ────────────────────────────────────────────────────────

export function listOfflineManifests(ownerId?: string): OfflineManifestRecord[] {
  const query = getDb().select().from(offlineManifestsTable);
  const rows = ownerId
    ? query.where(eq(offlineManifestsTable.ownerId, ownerId)).all()
    : query.all();
  return rows.map((r) => ({
    id: r.id,
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    filePath: r.filePath,
    sizeBytes: r.sizeBytes ?? null,
    createdAt: r.createdAt,
  }));
}

export function addOfflineManifestEntry(
  entry: Pick<OfflineManifestRecord, "ownerType" | "ownerId" | "filePath"> &
    Partial<Pick<OfflineManifestRecord, "sizeBytes">>,
): OfflineManifestRecord {
  const id = randomUUID();
  const createdAt = Date.now();
  getDb()
    .insert(offlineManifestsTable)
    .values({
      id,
      ownerType: entry.ownerType,
      ownerId: entry.ownerId,
      filePath: entry.filePath,
      sizeBytes: entry.sizeBytes ?? null,
      createdAt,
    })
    .run();
  flushDb();
  return { id, ownerType: entry.ownerType, ownerId: entry.ownerId, filePath: entry.filePath, sizeBytes: entry.sizeBytes ?? null, createdAt };
}

export function deleteOfflineManifests(ownerId: string): void {
  getDb()
    .delete(offlineManifestsTable)
    .where(eq(offlineManifestsTable.ownerId, ownerId))
    .run();
  flushDb();
}

/**
 * Reset all offline-related DB state without touching conversations, messages,
 * API keys, or app settings.  Called when the user removes Offline Mode.
 *
 * - Deletes every row from offline_models, offline_manifests
 * - Resets offline_installation to state="not-installed" (keeps the row)
 * - Resets offline_runtime to empty/unknown (keeps the row)
 */
export function clearOfflineData(): void {
  if (!isDatabaseReady()) return;
  const d = getDb();
  d.delete(offlineManifestsTable).run();
  d.delete(offlineModelsTable).run();
  d.update(offlineInstallationTable)
    .set({ state: "not-installed", offlineRoot: null, installedAt: null, updatedAt: Date.now() })
    .where(eq(offlineInstallationTable.id, "app"))
    .run();
  d.update(offlineRuntimeTable)
    .set({
      version: null,
      runtimePath: null,
      installedAt: null,
      lastHealthCheck: null,
      healthStatus: null,
      updatedAt: Date.now(),
    })
    .where(eq(offlineRuntimeTable.id, "app"))
    .run();
  flushDb();
}
