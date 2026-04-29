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
 * Error thrown when the llama.cpp release lookup ultimately fails.
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

  constructor(opts: { message: string; url: string; attempts: number; cause?: unknown }) {
    super(opts.message, opts.cause !== undefined ? { cause: opts.cause } : undefined);
    this.url = opts.url;
    this.attempts = opts.attempts;
    this.causeChain = opts.cause !== undefined ? formatErrorChain(opts.cause) : opts.message;
  }
}

/**
 * Network classification used purely for diagnostic messages — we don't change
 * behaviour based on the code, but the user/log gets a clearer hint than
 * "fetch failed".
 */
function classifyNetworkError(err: unknown): string | null {
  const chain = formatErrorChain(err);
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(chain)) {
    return "DNS lookup failed (ENOTFOUND) — the host could not be resolved. " +
      "Check your internet connection, DNS, or VPN/proxy settings.";
  }
  if (/ECONNRESET/i.test(chain)) {
    return "Connection reset by peer (ECONNRESET) — the network or a proxy " +
      "interrupted the request.";
  }
  if (/ETIMEDOUT|ESOCKETTIMEDOUT|UND_ERR_CONNECT_TIMEOUT|request.*timed out|timeout/i.test(chain)) {
    return "Network request timed out — GitHub may be slow or unreachable from this network.";
  }
  if (/ECONNREFUSED/i.test(chain)) {
    return "Connection refused (ECONNREFUSED) — a local proxy may be misconfigured.";
  }
  if (/CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|TLS|SSL/i.test(chain)) {
    return "TLS certificate validation failed — a corporate proxy or outdated " +
      "system trust store may be intercepting the connection.";
  }
  if (/proxy/i.test(chain)) {
    return "Proxy error while contacting GitHub — verify your HTTP(S)_PROXY settings.";
  }
  return null;
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
 *  - On terminal failure throws a `RuntimeReleaseLookupError` whose `.cause`
 *    holds the original error so the full chain (ENOTFOUND/ECONNRESET/TLS/…)
 *    survives the IPC boundary instead of collapsing to "fetch failed".
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
    const hint = classifyNetworkError(lastError);
    const baseMessage =
      `Failed to reach GitHub releases API after ${attemptsMade} attempt(s) ` +
      `over ${totalMs}ms (url=${apiUrl}).`;
    const fullMessage = hint ? `${baseMessage} ${hint}` : baseMessage;
    console.error(
      `[runtime-catalog] release lookup giving up: ${fullMessage}\n` +
        `  cause chain: ${formatErrorChain(lastError)}`,
    );
    throw new RuntimeReleaseLookupError({
      message: fullMessage,
      url: apiUrl,
      attempts: attemptsMade,
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
