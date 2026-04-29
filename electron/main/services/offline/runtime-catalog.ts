import { join } from "path";
import { existsSync } from "fs";
import { storageService } from "./storage";

// ── Network primitives (Electron-aware) ───────────────────────────────────────

/**
 * Lazily resolve Electron's `net.fetch` when running inside the main process.
 *
 * Electron's `net` module uses the Chromium network stack, which:
 *   - honours system proxy configuration (PAC, env vars, macOS network settings)
 *   - uses the OS trust store for TLS validation
 *   - tends to be more reliable than Node's `undici`-based global `fetch` in
 *     packaged apps (especially on macOS where corporate proxies / VPNs are common)
 *
 * We fall back to the global `fetch` when Electron is not available
 * (e.g. unit tests, tooling that imports this module outside an Electron host).
 */
function resolveFetch(): typeof fetch {
  try {
    // Avoid a top-level import so this module remains importable in non-Electron
    // contexts (the require call itself is what would throw there).
    const electron = require("electron") as typeof import("electron");
    if (electron?.net?.fetch) {
      // Bind to preserve `this` inside Electron's net implementation.
      return electron.net.fetch.bind(electron.net) as typeof fetch;
    }
  } catch {
    // Electron not present — fall through to global fetch.
  }
  return globalThis.fetch;
}

// ── Error reporting ───────────────────────────────────────────────────────────

/**
 * Recursively walk the `cause` chain of an error and produce a single
 * human-readable string.  Node/undici typically expose the underlying socket
 * failure (ENOTFOUND, ECONNRESET, ETIMEDOUT, CERT_*) only via `.cause`, which
 * the default `err.message` ("fetch failed") swallows.
 */
export function formatErrorChain(err: unknown, depth = 0): string {
  if (depth > 5) return "[cause chain truncated]";
  if (err == null) return String(err);
  if (typeof err !== "object") return String(err);

  const e = err as { message?: unknown; code?: unknown; name?: unknown; cause?: unknown };
  const parts: string[] = [];
  if (typeof e.name === "string" && e.name && e.name !== "Error") parts.push(e.name);
  if (typeof e.code === "string" && e.code) parts.push(`code=${e.code}`);
  if (typeof e.message === "string" && e.message) parts.push(e.message);

  const head = parts.length > 0 ? parts.join(" ") : String(err);
  if (e.cause != null) {
    return `${head}\n  caused by: ${formatErrorChain(e.cause, depth + 1)}`;
  }
  return head;
}

/**
 * Coarse categorisation of release-lookup failures, used to render an
 * actionable, friendly message in the offline-setup UI.
 *
 * The category is derived from the formatted cause chain — see
 * {@link classifyNetworkError}.  The UI maps each value to a localised
 * title + summary; the raw cause chain remains available as technical
 * details in a collapsible section.
 */
export type ReleaseLookupErrorCategory =
  | "network-offline"
  | "dns"
  | "timeout"
  | "rate-limited"
  | "tls-proxy"
  | "http-error"
  | "unknown";

/**
 * Error thrown when the llama.cpp release lookup ultimately fails — i.e.
 * both the live GitHub releases API and the pinned-fallback path were
 * exhausted.
 *
 * Preserves the original error as `.cause` (per the standard `Error.cause`
 * contract) so IPC consumers and developers can inspect the full chain
 * rather than the opaque `"fetch failed"` surfaced by Node/undici.
 */
export class RuntimeReleaseLookupError extends Error {
  override readonly name = "RuntimeReleaseLookupError";
  /** A pre-rendered, single-string view of the full cause chain. */
  readonly causeChain: string;
  /** The URL that was being fetched when the failure occurred. */
  readonly url: string;
  /** Number of attempts made before giving up. */
  readonly attempts: number;
  /** Coarse category for UI mapping. */
  readonly category: ReleaseLookupErrorCategory;

  constructor(opts: {
    message: string;
    url: string;
    attempts: number;
    category: ReleaseLookupErrorCategory;
    cause?: unknown;
  }) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.url = opts.url;
    this.attempts = opts.attempts;
    this.category = opts.category;
    this.causeChain = opts.cause !== undefined ? formatErrorChain(opts.cause) : opts.message;
  }
}

/**
 * Classify a network/HTTP error into a category + a longer human hint.
 * The hint is appended to the top-level error message; the category is
 * propagated to the renderer for UI mapping.
 */
function classifyNetworkError(err: unknown): {
  category: ReleaseLookupErrorCategory;
  hint: string | null;
} {
  const chain = formatErrorChain(err);
  const status = (err as { httpStatus?: number } | null)?.httpStatus;

  if (status === 403 || status === 429) {
    return {
      category: "rate-limited",
      hint:
        "GitHub API rate limit reached — too many requests from this network. " +
        "Wait a few minutes and try again, or use a different network.",
    };
  }
  if (status != null && status >= 500) {
    return {
      category: "http-error",
      hint:
        `GitHub returned HTTP ${status} — the service may be temporarily ` +
        `degraded. Retrying later usually fixes this.`,
    };
  }
  if (status != null && status >= 400) {
    return {
      category: "http-error",
      hint: `GitHub returned HTTP ${status} — the release endpoint is unreachable.`,
    };
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(chain)) {
    return {
      category: "dns",
      hint:
        "DNS lookup failed (ENOTFOUND) — the host could not be resolved. " +
        "Check your internet connection, DNS, or VPN/proxy settings.",
    };
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|request.*timed out|timeout/i.test(chain)) {
    return {
      category: "timeout",
      hint:
        "Network request timed out — GitHub may be slow or unreachable from this network.",
    };
  }
  if (/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|TLS|SSL/i.test(chain)) {
    return {
      category: "tls-proxy",
      hint:
        "TLS certificate validation failed — a corporate proxy or outdated " +
        "system trust store may be intercepting the connection.",
    };
  }
  if (/proxy/i.test(chain)) {
    return {
      category: "tls-proxy",
      hint: "Proxy error while contacting GitHub — verify your HTTP(S)_PROXY settings.",
    };
  }
  if (/ECONNRESET|ECONNREFUSED|ENETUNREACH|EHOSTUNREACH|EAI_FAIL/i.test(chain)) {
    return {
      category: "network-offline",
      hint:
        "Network connection failed — the device may be offline or a firewall " +
        "may be blocking outbound HTTPS to GitHub.",
    };
  }
  return { category: "unknown", hint: null };
}

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

/** Per-attempt timeout for the release-metadata HTTP request. */
const RELEASE_LOOKUP_TIMEOUT_MS = 15_000;
/** Total attempts (1 initial + 2 retries). */
const RELEASE_LOOKUP_MAX_ATTEMPTS = 3;
/** Base backoff in ms (doubled each attempt: 800 → 1600). */
const RELEASE_LOOKUP_BACKOFF_MS = 800;
/** Max length of a 4xx/5xx response body slice we keep for diagnostic output. */
const RESPONSE_BODY_HINT_MAX_LENGTH = 240;

/** Sleep helper for retry backoff. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * HTTP statuses we will not retry — the response is deterministic and a
 * second attempt would only delay the inevitable error.
 */
function isFatalHttpStatus(status: number): boolean {
  // 4xx except 408 (Request Timeout) and 429 (Too Many Requests).
  return status >= 400 && status < 500 && status !== 408 && status !== 429;
}

/**
 * Issue a single release-metadata request with a hard timeout.  Returns the
 * parsed JSON on success; throws an error whose `.cause` is the underlying
 * network/HTTP failure on failure.
 */
async function fetchReleaseOnce(
  url: string,
  attempt: number,
): Promise<GitHubRelease> {
  const fetchImpl = resolveFetch();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), RELEASE_LOOKUP_TIMEOUT_MS);

  const startedAt = Date.now();
  try {
    const res = await fetchImpl(url, {
      headers: {
        "User-Agent": "GHChat/0.2.0",
        Accept: "application/vnd.github.v3+json",
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      // Read a short body slice to aid diagnosis (e.g. GitHub rate-limit JSON)
      // without dumping a megabyte of HTML on the user.
      let bodyHint = "";
      try {
        const text = await res.text();
        bodyHint =
          text.length > RESPONSE_BODY_HINT_MAX_LENGTH
            ? `${text.slice(0, RESPONSE_BODY_HINT_MAX_LENGTH)}…`
            : text;
      } catch {
        /* ignore — body is optional context */
      }
      const httpErr = new Error(
        `GitHub API returned HTTP ${res.status} ${res.statusText}` +
          (bodyHint ? ` — ${bodyHint}` : ""),
      );
      // Tag with a code so the retry layer can decide fatal vs transient.
      (httpErr as Error & { httpStatus?: number }).httpStatus = res.status;
      throw httpErr;
    }

    const release = (await res.json()) as GitHubRelease;
    const elapsedMs = Date.now() - startedAt;
    console.log(
      `[runtime-catalog] release lookup attempt ${attempt} succeeded in ${elapsedMs}ms ` +
        `(tag=${release.tag_name}, assets=${release.assets.length})`,
    );
    return release;
  } catch (err) {
    const elapsedMs = Date.now() - startedAt;
    // Distinguish abort-from-timeout from a generic abort.
    if (
      controller.signal.aborted &&
      (err instanceof Error) &&
      (err.name === "AbortError" || /aborted/i.test(err.message))
    ) {
      const timeoutErr = new Error(
        `Release lookup timed out after ${RELEASE_LOOKUP_TIMEOUT_MS}ms`,
      );
      (timeoutErr as Error & { code?: string }).code = "ETIMEDOUT";
      console.warn(
        `[runtime-catalog] release lookup attempt ${attempt} timed out after ${elapsedMs}ms`,
      );
      throw timeoutErr;
    }
    console.warn(
      `[runtime-catalog] release lookup attempt ${attempt} failed after ${elapsedMs}ms: ` +
        formatErrorChain(err),
    );
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

// ── Pinned fallback release ───────────────────────────────────────────────────

/**
 * Pinned, known-good llama.cpp release used as a fallback when the live
 * GitHub releases API lookup ultimately fails (network down, rate-limited,
 * proxy misconfigured, etc.).
 *
 * Why a pinned tag instead of "latest"?
 *   - Release archives are served from `objects.githubusercontent.com` /
 *     `github.com/.../releases/download/...` which is a separate path from
 *     `api.github.com` and frequently keeps working when the JSON API is
 *     rate-limited or returns 5xx.
 *   - It gives us a deterministic recovery path so the offline installer
 *     can succeed even on networks that can't reach the metadata API.
 *
 * Maintenance:
 *   - Bump the tag periodically to follow upstream stability fixes.
 *   - Verify the per-platform asset filenames in `PINNED_FALLBACK_ASSETS`
 *     still exist on the upstream release page when bumping.
 *   - Operators can override via `GHCHAT_LLAMA_FALLBACK_TAG` to ship a
 *     newer pinned tag without a code change.
 *
 * Currently pinned: `b8967` — verified to exist with the expected
 * macos-arm64 / macos-x64 / win-cpu-x64 / ubuntu-x64 assets at
 * https://github.com/ggml-org/llama.cpp/releases/tag/b8967 (verified 2026-04-29).
 */
const PINNED_FALLBACK_TAG_DEFAULT = "b8967";

/**
 * Per-platform fallback asset names for the pinned tag. The list is
 * intentionally narrow — one plain CPU build per supported platform.
 *
 * If you bump `PINNED_FALLBACK_TAG_DEFAULT` you must also verify these
 * filenames still exist on the release page; the upstream naming scheme
 * is stable but not contractual.
 */
const PINNED_FALLBACK_ASSETS: Record<
  string,
  { assetName: string; archiveExt: RuntimeArchiveExtension }
> = {
  "macos-arm64": { assetName: "llama-{TAG}-bin-macos-arm64.tar.gz", archiveExt: ".tar.gz" },
  "macos-x64": { assetName: "llama-{TAG}-bin-macos-x64.tar.gz", archiveExt: ".tar.gz" },
  // Windows uses a CPU-suffixed plain build in the upstream naming scheme.
  "win-x64": { assetName: "llama-{TAG}-bin-win-cpu-x64.zip", archiveExt: ".zip" },
  "ubuntu-x64": { assetName: "llama-{TAG}-bin-ubuntu-x64.tar.gz", archiveExt: ".tar.gz" },
};

/**
 * Build the pinned-fallback release info for the current platform.
 * Returns `null` if the current platform has no fallback entry.
 */
function getPinnedFallbackRelease(platformTag: string): {
  tag: string;
  assetName: string;
  downloadUrl: string;
  sizeBytes: number;
  archiveExt: RuntimeArchiveExtension;
} | null {
  const tag = process.env.GHCHAT_LLAMA_FALLBACK_TAG?.trim() || PINNED_FALLBACK_TAG_DEFAULT;
  const entry = PINNED_FALLBACK_ASSETS[platformTag];
  if (!entry) return null;
  const assetName = entry.assetName.replace("{TAG}", tag);
  return {
    tag,
    assetName,
    // Release-asset downloads live on a different host than the JSON API and
    // commonly remain reachable even when api.github.com is rate-limited.
    downloadUrl: `https://github.com/ggml-org/llama.cpp/releases/download/${tag}/${assetName}`,
    // Size is unknown without a HEAD request; the downloader gracefully
    // handles size=0 by reporting received bytes only.
    sizeBytes: 0,
    archiveExt: entry.archiveExt,
  };
}

/** Source of the resolved release info — `"live"` from API, `"pinned-fallback"` otherwise. */
export type ReleaseSource = "live" | "pinned-fallback";

export interface ResolvedRuntimeRelease {
  tag: string;
  assetName: string;
  downloadUrl: string;
  sizeBytes: number;
  archiveExt: RuntimeArchiveExtension;
  /** Where this info came from — used by the install pipeline to log/inform. */
  source: ReleaseSource;
}

/**
 * Query the GitHub releases API for the latest llama.cpp release and return
 * the download URL and expected size for the current platform/arch.
 *
 * Behaviour:
 *  - Uses Electron's `net.fetch` when available so packaged apps respect the
 *    system proxy / OS trust store.
 *  - Each request is bounded by `RELEASE_LOOKUP_TIMEOUT_MS`.
 *  - Up to `RELEASE_LOOKUP_MAX_ATTEMPTS` attempts with exponential backoff
 *    are made for transient failures (network errors and 5xx/408/429).
 *  - When the live lookup is exhausted, falls back to a pinned known-good
 *    release for the current platform (see `PINNED_FALLBACK_*` above).
 *    This step is logged explicitly.  The fallback can be disabled by
 *    setting `GHCHAT_LLAMA_DISABLE_FALLBACK=1` (e.g. in tests).
 *  - On terminal failure (live + fallback both unavailable, or no fallback
 *    for this platform) throws a `RuntimeReleaseLookupError` whose `.cause`
 *    holds the original error so the full chain (ENOTFOUND/ECONNRESET/TLS/…)
 *    survives the IPC boundary instead of collapsing to "fetch failed".
 */
export async function fetchLatestRuntimeRelease(): Promise<ResolvedRuntimeRelease> {
  const apiUrl =
    "https://api.github.com/repos/ggerganov/llama.cpp/releases/latest";
  const platformTag = getRuntimePlatformTag();

  console.log(
    `[runtime-catalog] starting llama.cpp release lookup ` +
      `url=${apiUrl} platform=${process.platform} arch=${process.arch} ` +
      `tag="${platformTag}" timeoutMs=${RELEASE_LOOKUP_TIMEOUT_MS} ` +
      `maxAttempts=${RELEASE_LOOKUP_MAX_ATTEMPTS}`,
  );
  const overallStart = Date.now();

  let release: GitHubRelease | null = null;
  let lastError: unknown = null;
  let attemptsMade = 0;

  for (let attempt = 1; attempt <= RELEASE_LOOKUP_MAX_ATTEMPTS; attempt++) {
    attemptsMade = attempt;
    try {
      release = await fetchReleaseOnce(apiUrl, attempt);
      break;
    } catch (err) {
      lastError = err;
      const status = (err as { httpStatus?: number }).httpStatus;
      if (status != null && isFatalHttpStatus(status)) {
        // 4xx (except 408/429) — retrying is pointless.
        break;
      }
      if (attempt < RELEASE_LOOKUP_MAX_ATTEMPTS) {
        const backoff = RELEASE_LOOKUP_BACKOFF_MS * 2 ** (attempt - 1);
        console.log(
          `[runtime-catalog] retrying release lookup in ${backoff}ms ` +
            `(attempt ${attempt + 1}/${RELEASE_LOOKUP_MAX_ATTEMPTS})`,
        );
        await delay(backoff);
      }
    }
  }

  if (!release) {
    const totalMs = Date.now() - overallStart;
    const { category, hint } = classifyNetworkError(lastError);
    const baseMessage =
      `Failed to reach GitHub releases API after ${attemptsMade} attempt(s) ` +
      `over ${totalMs}ms (url=${apiUrl}).`;
    const liveFailureMessage = hint ? `${baseMessage} ${hint}` : baseMessage;
    console.warn(
      `[runtime-catalog] live release lookup giving up: ${liveFailureMessage}\n` +
        `  cause chain: ${formatErrorChain(lastError)}`,
    );

    // ── Pinned-fallback path ──────────────────────────────────────────────
    // Release-asset downloads are served from a different host than the
    // metadata API and frequently keep working when api.github.com is
    // rate-limited or otherwise unhealthy.  Fall back to a known-good
    // pinned release so the install can still complete.
    const fallbackDisabled = process.env.GHCHAT_LLAMA_DISABLE_FALLBACK === "1";
    const pinned = fallbackDisabled ? null : getPinnedFallbackRelease(platformTag);
    if (pinned) {
      console.warn(
        `[runtime-catalog] FALLBACK ACTIVATED — using pinned llama.cpp release ` +
          `tag=${pinned.tag} asset=${pinned.assetName} ` +
          `url=${pinned.downloadUrl} ` +
          `(reason: ${category}; live API unreachable). ` +
          `If this is incorrect, set GHCHAT_LLAMA_FALLBACK_TAG to override or ` +
          `GHCHAT_LLAMA_DISABLE_FALLBACK=1 to disable the fallback path.`,
      );
      return { ...pinned, source: "pinned-fallback" };
    }

    if (fallbackDisabled) {
      console.warn(
        "[runtime-catalog] pinned fallback skipped — GHCHAT_LLAMA_DISABLE_FALLBACK=1",
      );
    } else {
      console.warn(
        `[runtime-catalog] no pinned fallback configured for platform tag "${platformTag}"`,
      );
    }

    throw new RuntimeReleaseLookupError({
      message: liveFailureMessage,
      url: apiUrl,
      attempts: attemptsMade,
      category,
      cause: lastError,
    });
  }

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
    // The live release exists but doesn't carry a usable asset for this
    // platform — fall back to the pinned release rather than failing the
    // install outright.
    const pinned =
      process.env.GHCHAT_LLAMA_DISABLE_FALLBACK === "1"
        ? null
        : getPinnedFallbackRelease(platformTag);
    if (pinned) {
      console.warn(
        `[runtime-catalog] FALLBACK ACTIVATED — release ${release.tag_name} has ` +
          `no asset matching tag "${platformTag}"; using pinned ` +
          `tag=${pinned.tag} asset=${pinned.assetName}`,
      );
      return { ...pinned, source: "pinned-fallback" };
    }
    throw new Error(
      `No llama.cpp binary found for platform tag "${platformTag}" in ` +
        `release ${release.tag_name}. Available assets: ` +
        release.assets.map((a) => a.name).join(", "),
    );
  }

  const chosen = candidates[0];
  const altCandidate = candidates.length > 1 ? candidates[1] : null;

  console.log(
    `[runtime-catalog] platform tag "${platformTag}" matched ` +
      `${candidates.length} asset(s): ` +
      candidates.map((c) => `${c.asset.name}(score=${c.score})`).join(", "),
  );
  console.log(
    `[runtime-catalog] selected asset: ${chosen.asset.name} ` +
      `(${chosen.isPlain ? "plain" : "variant"}, ${chosen.ext}) ` +
      (altCandidate ? `— next-best would be: ${altCandidate.asset.name}` : "— no alternative available"),
  );

  return {
    tag: release.tag_name,
    assetName: chosen.asset.name,
    downloadUrl: chosen.asset.browser_download_url,
    sizeBytes: chosen.asset.size,
    archiveExt: chosen.ext,
    source: "live",
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
