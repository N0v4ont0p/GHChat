import { safeStorage, app } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync, renameSync } from "fs";

const keyPath = () => join(app.getPath("userData"), ".or-key");

/**
 * One-time migration: if the legacy `.hf-key` file exists but the new `.or-key`
 * does not, move it so existing users keep their stored API key after the
 * Hugging Face → OpenRouter provider migration.
 */
function migrateLegacyKeyFile(): void {
  const legacy = join(app.getPath("userData"), ".hf-key");
  const current = keyPath();
  if (existsSync(legacy) && !existsSync(current)) {
    try {
      renameSync(legacy, current);
      console.log("[keychain] migrated .hf-key → .or-key");
    } catch (err) {
      console.warn("[keychain] migration of .hf-key failed:", err);
    }
  }
}

export function getApiKey(): string {
  try {
    migrateLegacyKeyFile();
    if (!existsSync(keyPath())) return "";
    if (!safeStorage.isEncryptionAvailable()) {
      console.warn("[keychain] safeStorage encryption unavailable — cannot decrypt stored key");
      return "";
    }
    const encrypted = readFileSync(keyPath());
    return safeStorage.decryptString(encrypted);
  } catch {
    return "";
  }
}

export function setApiKey(key: string): void {
  if (!safeStorage.isEncryptionAvailable()) {
    console.warn("[keychain] safeStorage encryption unavailable — API key NOT stored");
    return;
  }
  const encrypted = safeStorage.encryptString(key);
  writeFileSync(keyPath(), encrypted);
}

export function deleteApiKey(): void {
  try {
    if (existsSync(keyPath())) {
      unlinkSync(keyPath());
    }
    // Also remove the legacy file if it still exists
    const legacy = join(app.getPath("userData"), ".hf-key");
    if (existsSync(legacy)) {
      unlinkSync(legacy);
    }
  } catch {
    // Ignore errors during deletion
  }
}
