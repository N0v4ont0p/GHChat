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

/** Archive extensions we know how to extract in `install-manager.ts`. */
const SUPPORTED_ARCHIVE_EXTENSIONS = [".zip", ".tar.gz", ".tgz"] as const;
export type RuntimeArchiveExtension = (typeof SUPPORTED_ARCHIVE_EXTENSIONS)[number];

/** Strip a known archive extension from an asset name, or return null. */
function stripArchiveExtension(
  name: string,
): { stem: string; ext: RuntimeArchiveExtension } | null {
  const lower = name.toLowerCase();
  for (const ext of SUPPORTED_ARCHIVE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return { stem: name.slice(0, name.length - ext.length), ext };
    }
  }
  return null;
}

/**
 * Score a candidate asset for the given platform tag. Lower is better.
 *
 * Selection rule (documented for future maintainers):
 *
 *  1. The asset filename **must** contain the platform tag as a token
 *     bounded by `-`, `.` or string boundaries — so `macos-arm64` does
 *     not accidentally match `macos-arm64-kleidiai` only by substring.
 *  2. Among matching candidates we prefer the variant whose stem ends
 *     exactly at the platform tag (the "plain" build). Variants with an
 *     extra suffix after the tag (e.g. `-kleidiai`, `-cuda`, `-vulkan`,
 *     `-hip`) target specialized hardware/runtimes that may not be
 *     present on the user's machine, and are reserved as fallbacks.
 *  3. Within the plain group, `.zip` is preferred over `.tar.gz` only
 *     because it is the historical default; either works.
 *
 * Returns `null` when the asset does not match the platform tag at all.
 */
function scoreAsset(
  assetName: string,
  platformTag: string,
): { score: number; ext: RuntimeArchiveExtension; isPlain: boolean } | null {
  const parsed = stripArchiveExtension(assetName);
  if (!parsed) return null;

  // Token-boundary match: tag must be surrounded by start/end or `-`/`.`.
  // We match on the stem so an extension like ".tar.gz" doesn't confuse it.
  const escaped = platformTag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tokenRegex = new RegExp(`(^|[-.])${escaped}($|[-.])`);
  if (!tokenRegex.test(parsed.stem)) return null;

  // "Plain" = the stem ends exactly at the platform tag (no `-suffix` after).
  const endsAtTag =
    parsed.stem.endsWith(`-${platformTag}`) || parsed.stem === platformTag;

  // Lower score wins. Plain variants beat suffixed variants by a wide margin.
  let score = endsAtTag ? 0 : 100;
  // Prefer .zip slightly over .tar.gz for stability of historical behaviour.
  if (parsed.ext !== ".zip") score += 1;

  return { score, ext: parsed.ext, isPlain: endsAtTag };
}

/**
 * Query the GitHub releases API for the latest llama.cpp release and return
 * the download URL and expected size for the current platform/arch.
 *
 * Throws when the API is unreachable or no matching asset is found.
 */
export async function fetchLatestRuntimeRelease(): Promise<{
  tag: string;
  assetName: string;
  downloadUrl: string;
  sizeBytes: number;
  archiveExt: RuntimeArchiveExtension;
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

  console.log(
    `[runtime-catalog] resolving llama.cpp release ${release.tag_name} for ` +
      `platform=${process.platform} arch=${process.arch} tag="${platformTag}" ` +
      `(${release.assets.length} assets)`,
  );

  // Score every asset and keep only the matches, sorted best-first.
  type Candidate = {
    asset: GitHubAsset;
    score: number;
    ext: RuntimeArchiveExtension;
    isPlain: boolean;
  };
  const candidates: Candidate[] = [];
  for (const asset of release.assets) {
    const scored = scoreAsset(asset.name, platformTag);
    if (scored) candidates.push({ asset, ...scored });
  }
  candidates.sort((a, b) => a.score - b.score);

  if (candidates.length === 0) {
    throw new Error(
      `No llama.cpp binary found for platform tag "${platformTag}" in ` +
        `release ${release.tag_name}. Available assets: ` +
        release.assets.map((a) => a.name).join(", "),
    );
  }

  const chosen = candidates[0];
  const fallback = candidates.length > 1 ? candidates[1] : null;

  console.log(
    `[runtime-catalog] platform tag "${platformTag}" matched ` +
      `${candidates.length} asset(s): ` +
      candidates.map((c) => `${c.asset.name}(score=${c.score})`).join(", "),
  );
  console.log(
    `[runtime-catalog] selected asset: ${chosen.asset.name} ` +
      `(${chosen.isPlain ? "plain" : "variant"}, ${chosen.ext}) ` +
      (fallback ? `— fallback would be: ${fallback.asset.name}` : "— no fallback available"),
  );

  return {
    tag: release.tag_name,
    assetName: chosen.asset.name,
    downloadUrl: chosen.asset.browser_download_url,
    sizeBytes: chosen.asset.size,
    archiveExt: chosen.ext,
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
