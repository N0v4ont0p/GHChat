import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_HOST = "http://localhost:11434";

export function normalizeHost(host?: string | null) {
  const value = host?.trim();

  if (!value) {
    return DEFAULT_HOST;
  }

  return value.endsWith("/") ? value.slice(0, -1) : value;
}

export function getDataDir() {
  const customDir = process.env.GHCHAT_DATA_DIR?.trim();
  const dataDir = customDir
    ? path.resolve(customDir)
    : path.join(os.homedir(), ".ghchat");

  fs.mkdirSync(dataDir, { recursive: true });

  return dataDir;
}

export const defaultBackendHost = normalizeHost(process.env.GHCHAT_BACKEND_HOST);
