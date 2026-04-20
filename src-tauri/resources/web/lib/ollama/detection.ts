import "server-only";

import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { createProvider } from "@/lib/providers";
import type { BackendStatus } from "@/types";

const COMMON_OLLAMA_PATHS = [
  "/Applications/Ollama.app",
  "/usr/local/bin/ollama",
  "/opt/homebrew/bin/ollama",
  "/Applications/Ollama.app/Contents/MacOS/Ollama",
];

function detectCli() {
  try {
    const output = execFileSync("which", ["ollama"], {
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();

    return output.length > 0;
  } catch {
    return false;
  }
}

export async function detectOllamaState(host: string) {
  const provider = createProvider(host);
  const health = await provider.healthCheck();

  const existingPaths = COMMON_OLLAMA_PATHS.filter((entry) => fs.existsSync(entry));
  const cliDetected = detectCli();
  const hasPresenceHints = existingPaths.length > 0 || cliDetected;

  let status: BackendStatus;

  if (health.ok) {
    status = "online";
  } else if (hasPresenceHints) {
    status = "not_running";
  } else if (health.statusCode && health.statusCode >= 500) {
    status = "unreachable";
  } else {
    status = "not_detected";
  }

  return {
    status,
    host,
    details: {
      cliDetected,
      existingPaths,
      healthMessage: health.message,
    },
  };
}
