import { join } from "path";
import { existsSync } from "fs";
import { storageService } from "./storage";

// ── Runtime binary constants ──────────────────────────────────────────────────

/** The llama.cpp binary entry-point name (without path). */
export const RUNTIME_BINARY_NAME =
  process.platform === "win32" ? "llama-server.exe" : "llama-server";

/**
 * Derive the platform/arch tag used in the llama.cpp GitHub release
 * asset names, e.g. "macos-arm64", "macos-x64", "ubuntu-x64", "win-x64".
 *
 * Throws when the current platform/arch combination has no pre-built release.
 */
export function getRuntimePlatformTag(): string {
  const { platform, arch } = process;
  if (platform === "darwin" && arch === "arm64") return "macos-arm64";
  if (platform === "darwin" && arch === "x64") return "macos-x64";
  if (platform === "win32" && arch === "x64") return "win-x64";
  if (platform === "linux" && arch === "x64") return "ubuntu-x64";
  throw new Error(
    `No pre-built llama.cpp release available for platform=${platform} arch=${arch}. ` +
      `Supported combinations: darwin/arm64, darwin/x64, win32/x64, linux/x64.`,
  );
}

// ── GitHub releases API ───────────────────────────────────────────────────────

interface GitHubAsset {
  name: string;
  browser_download_url: string;
  size: number;
}

interface GitHubRelease {
  tag_name: string;
  assets: GitHubAsset[];
}

/**
 * Query the GitHub releases API for the latest llama.cpp release and return
 * the download URL and expected size for the current platform/arch.
 *
 * Throws when the API is unreachable or no matching asset is found.
 */
export async function fetchLatestRuntimeRelease(): Promise<{
  tag: string;
  downloadUrl: string;
  sizeBytes: number;
}> {
  const apiUrl =
    "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest";

  const res = await fetch(apiUrl, {
    headers: {
      "User-Agent": "GHChat/0.2.0",
      Accept: "application/vnd.github.v3+json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `GitHub API returned ${res.status} while looking for llama.cpp release. ` +
        `Check your internet connection and try again.`,
    );
  }

  const release = (await res.json()) as GitHubRelease;
  const platformTag = getRuntimePlatformTag();

  // Match the asset by platform tag and zip extension.
  // Example asset name: "llama-b5621-bin-macos-arm64.zip"
  const asset = release.assets.find(
    (a) => a.name.includes(platformTag) && a.name.endsWith(".zip"),
  );

  if (!asset) {
    throw new Error(
      `No llama.cpp binary found for platform tag "${platformTag}" in ` +
        `release ${release.tag_name}. Available assets: ` +
        release.assets.map((a) => a.name).join(", "),
    );
  }

  return {
    tag: release.tag_name,
    downloadUrl: asset.browser_download_url,
    sizeBytes: asset.size,
  };
}

// ── Binary path resolution ────────────────────────────────────────────────────

/**
 * Return the absolute path to the llama-server binary that should be used
 * by the runtime manager.
 *
 * Resolution order:
 *  1. `{offlineRoot}/runtime/llama-server[.exe]`  (installed via the install flow)
 *  2. `GHCHAT_LLAMA_SERVER` environment variable    (developer override)
 *
 * Throws when no usable binary can be located.
 */
export function resolveRuntimeBinaryPath(): string {
  // 1. Managed binary downloaded during the install flow.
  const managed = join(
    storageService.getSubdir("runtime"),
    RUNTIME_BINARY_NAME,
  );
  if (existsSync(managed)) return managed;

  // 2. Developer / CI override.
  const envOverride = process.env.GHCHAT_LLAMA_SERVER;
  if (envOverride && existsSync(envOverride)) return envOverride;

  throw new Error(
    `llama-server binary not found. ` +
      `Expected at ${managed}. ` +
      `Run the offline install flow to download it, ` +
      `or set GHCHAT_LLAMA_SERVER to its absolute path.`,
  );
}
