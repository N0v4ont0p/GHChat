import { safeStorage, app } from "electron";
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";

const keyPath = () => join(app.getPath("userData"), ".hf-key");

export function getApiKey(): string {
  try {
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
  } catch {
    // Ignore errors during deletion
  }
}
