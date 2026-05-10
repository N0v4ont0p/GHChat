import { join, dirname } from "path";
import {
  createWriteStream,
  createReadStream,
  copyFileSync,
  existsSync,
  statSync,
  lstatSync,
  readFileSync,
  readlinkSync,
  symlinkSync,
  renameSync,
  unlinkSync,
  writeFileSync,
  mkdirSync,
  chmodSync,
  readdirSync,
  rmSync,
} from "fs";
import { createHash } from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import * as https from "https";
import * as http from "http";
import { offlineCatalog } from "./catalog";
import { storageService } from "./storage";
import { modelRegistry } from "./model-registry";
import {
  fetchLatestRuntimeRelease,
  formatErrorChain,
  getRuntimePlatformTag,
  RuntimeReleaseLookupError,
  RUNTIME_BINARY_NAME,
  type ReleaseLookupErrorCategory,
} from "./runtime-catalog";
import { addOfflineManifestEntry, clearOfflineData, isDatabaseReady } from "../database";
import type { OfflineInstallPhase, OfflineInstallProgress } from "../../../../src/types";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

type ProgressCallback = (progress: OfflineInstallProgress) => void;

// ── Helpers ───────────────────────────────────────────────────────────────────

const BYTES_PER_GB = 1024 ** 3;

/** Maximum redirect hops we'll follow during a download. */
const MAX_REDIRECTS = 5;

/** Maximum length of a 4xx/5xx response body slice we keep for diagnostics. */
const RESPONSE_BODY_HINT_MAX_LENGTH = 240;

/** Logical "purpose" of a download — used for log messages and error context. */
type DownloadPurpose = "runtime" | "model";

/**
 * Structured error thrown by {@link downloadFile} when the HTTP response is
 * non-2xx (after redirect resolution).  Carries enough context to render an
 * actionable message in the UI **and** in main-process logs:
 *
 *  - `status`: final HTTP status code (e.g. 401, 403, 404)
 *  - `purpose`: which install step the failure belongs to (runtime/model)
 *  - `host`: host that returned the error (post-redirect)
 *  - `finalUrl`: full URL after redirect resolution
 *  - `redirectChain`: every URL visited (initial → ... → final), one per line
 *  - `contentType`/`bodyHint`: short response body slice for diagnosis
 *  - `headersHint`: a small, safe header subset (rate-limit / server / type)
 *  - `phase`/`pct`: install pipeline coordinates at failure
 */
export class DownloadHttpError extends Error {
  override readonly name = "DownloadHttpError";
  readonly status: number;
  readonly statusText: string;
  readonly purpose: DownloadPurpose;
  readonly initialUrl: string;
  readonly finalUrl: string;
  readonly host: string;
  readonly redirectChain: string[];
  readonly contentType: string | undefined;
  readonly bodyHint: string | undefined;
  readonly headersHint: Record<string, string>;
  readonly phase: OfflineInstallPhase;
  readonly pct: number;

  constructor(opts: {
    message: string;
    status: number;
    statusText: string;
    purpose: DownloadPurpose;
    initialUrl: string;
    finalUrl: string;
    host: string;
    redirectChain: string[];
    contentType?: string;
    bodyHint?: string;
    headersHint: Record<string, string>;
    phase: OfflineInstallPhase;
    pct: number;
  }) {
    super(opts.message);
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.purpose = opts.purpose;
    this.initialUrl = opts.initialUrl;
    this.finalUrl = opts.finalUrl;
    this.host = opts.host;
    this.redirectChain = opts.redirectChain;
    this.contentType = opts.contentType;
    this.bodyHint = opts.bodyHint;
    this.headersHint = opts.headersHint;
    this.phase = opts.phase;
    this.pct = opts.pct;
  }
}

/**
 * Render a `DownloadHttpError` as a multi-line technical diagnostic string,
 * suitable for the renderer's "Show technical details" section and the
 * main-process console.
 */
function renderDownloadErrorDetails(err: DownloadHttpError): string {
  const lines: string[] = [
    `purpose:   ${err.purpose}`,
    `phase:     ${err.phase} (pct=${err.pct})`,
    `status:    HTTP ${err.status} ${err.statusText}`.trimEnd(),
    `host:      ${err.host}`,
    `finalUrl:  ${err.finalUrl}`,
  ];
  if (err.redirectChain.length > 1) {
    lines.push(`redirects: ${err.redirectChain.length - 1}`);
    for (let i = 0; i < err.redirectChain.length; i++) {
      lines.push(`  [${i}] ${err.redirectChain[i]}`);
    }
  }
  if (err.contentType) lines.push(`contentType: ${err.contentType}`);
  const safeHeaderKeys = Object.keys(err.headersHint);
  if (safeHeaderKeys.length > 0) {
    lines.push("headers:");
    for (const k of safeHeaderKeys) {
      lines.push(`  ${k}: ${err.headersHint[k]}`);
    }
  }
  if (err.bodyHint) lines.push(`body: ${err.bodyHint}`);
  return lines.join("\n");
}

/**
 * Map an HTTP status code from a download to an `OfflineErrorCategory`.
 * 401/403 → "auth-required" (the most likely actionable cause: gated repo
 * or missing/incorrect HF token).  429 → "rate-limited".  Other 4xx/5xx →
 * "http-error".
 */
function classifyDownloadStatus(
  status: number,
): "auth-required" | "rate-limited" | "http-error" {
  if (status === 401 || status === 403) return "auth-required";
  if (status === 429) return "rate-limited";
  return "http-error";
}

/**
 * Resolve an optional bearer token for HuggingFace requests from the
 * environment.  Honours the same set of variable names the official HF
 * tooling looks at, plus a GHchat-specific override that wins over them.
 *
 * Returns `undefined` when no token is configured — in that case the
 * downloader sends no `Authorization` header at all.
 */
function resolveHuggingFaceToken(): string | undefined {
  const candidates = [
    process.env.GHCHAT_HF_TOKEN,
    process.env.HUGGING_FACE_HUB_TOKEN,
    process.env.HUGGINGFACE_HUB_TOKEN,
    process.env.HF_TOKEN,
  ];
  for (const v of candidates) {
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return undefined;
}

/** A safe subset of response headers we log on failure. */
const SAFE_HEADER_KEYS = [
  "content-type",
  "content-length",
  "server",
  "x-error-code",
  "x-error-message",
  "x-request-id",
  "x-amz-request-id",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
] as const;

/** Pull a small, safe subset of headers from an `IncomingMessage` for logging. */
function pickSafeHeaders(headers: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {};
  for (const k of SAFE_HEADER_KEYS) {
    const v = headers[k];
    if (typeof v === "string") out[k] = v;
    else if (Array.isArray(v) && v.length > 0) out[k] = v.join(", ");
  }
  return out;
}

/**
 * Download a file from `url` to `destPath`, following up to MAX_REDIRECTS
 * redirects.  Reports `(receivedBytes, totalBytes)` to `onData` on each chunk.
 *
 * Headers:
 *  - Always sends `User-Agent: GHChat/<version>` (HuggingFace and several CDNs
 *    return 4xx for missing UA).
 *  - Sends `Accept: application/octet-stream` so HF resolves to the raw LFS
 *    object instead of a metadata page.
 *  - Sends `Authorization: Bearer <token>` only when an HF token is present
 *    in the environment.  The header is **dropped on cross-host redirects**
 *    so we never leak it to a CDN host that didn't issue it (and so the CDN
 *    doesn't reject a foreign token with 401/403).
 *
 * On non-2xx HTTP responses, throws a `DownloadHttpError` carrying the full
 * redirect chain, status, host, content-type, safe header subset and a short
 * body slice, so the install pipeline can map it to a precise category and
 * the renderer can display it under "Technical details".
 */
function downloadFile(
  url: string,
  destPath: string,
  onData: (receivedBytes: number, totalBytes: number) => void,
  ctx: {
    purpose: DownloadPurpose;
    phase: OfflineInstallPhase;
    pct: number;
  },
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Ensure the parent directory exists before opening the write stream.
    mkdirSync(join(destPath, ".."), { recursive: true });

    const initialUrl = url;
    const redirectChain: string[] = [url];
    const initialHost = (() => {
      try {
        return new URL(url).host;
      } catch {
        return "";
      }
    })();
    const hfToken = resolveHuggingFaceToken();
    const tokenLogStatus = hfToken ? "present" : "absent";

    console.log(
      `[install-manager] download starting purpose=${ctx.purpose} ` +
        `phase=${ctx.phase} pct=${ctx.pct} host=${initialHost} ` +
        `hfToken=${tokenLogStatus} url=${url}`,
    );

    function get(urlStr: string, redirectCount: number): void {
      if (redirectCount > MAX_REDIRECTS) {
        reject(
          new Error(
            `Too many redirects (>${MAX_REDIRECTS}) while downloading ` +
              `${ctx.purpose} from ${initialHost}`,
          ),
        );
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(urlStr);
      } catch {
        reject(new Error(`Invalid ${ctx.purpose} download URL: ${urlStr}`));
        return;
      }

      const mod = parsedUrl.protocol === "https:" ? https : http;

      // Build request headers.  Authorization is only attached to the initial
      // host (initialHost) — never to redirect targets on a different host —
      // to avoid leaking tokens to (and being rejected by) HuggingFace's CDN.
      const headers: Record<string, string> = {
        "User-Agent": "GHChat/0.2.0",
        Accept: "application/octet-stream",
      };
      const sameHostAsInitial = parsedUrl.host === initialHost;
      if (hfToken && sameHostAsInitial) {
        headers["Authorization"] = `Bearer ${hfToken}`;
      }

      const req = mod.get(urlStr, { headers }, (res) => {
        const status = res.statusCode ?? 0;

        // Redirect handling — collect the chain so we can report it on failure.
        if (status >= 300 && status < 400 && res.headers.location) {
          // Resolve the `Location` header against the current request URL so
          // relative redirects work (RFC 7231 allows them, though most CDNs
          // emit absolute URLs).
          let nextUrl: string;
          try {
            nextUrl = new URL(res.headers.location, urlStr).toString();
          } catch {
            req.destroy();
            reject(
              new Error(
                `Invalid redirect target "${res.headers.location}" while ` +
                  `downloading ${ctx.purpose} from ${parsedUrl.host}`,
              ),
            );
            return;
          }
          redirectChain.push(nextUrl);
          // Drain and discard the redirect response body so the socket can be
          // reused / cleanly closed.
          res.resume();
          console.log(
            `[install-manager] download redirect purpose=${ctx.purpose} ` +
              `status=${status} from=${parsedUrl.host} ` +
              `to=${(() => { try { return new URL(nextUrl).host; } catch { return "?"; } })()}`,
          );
          get(nextUrl, redirectCount + 1);
          return;
        }

        if (status < 200 || status >= 300) {
          // Read a short response body slice for diagnostics. We cap the
          // accumulated bytes so a 1 MB HTML error page can't blow up memory
          // or our log lines.
          const chunks: Buffer[] = [];
          let total = 0;
          const cap = RESPONSE_BODY_HINT_MAX_LENGTH * 4;
          res.on("data", (chunk: Buffer) => {
            if (total < cap) {
              const remaining = cap - total;
              chunks.push(chunk.length > remaining ? chunk.subarray(0, remaining) : chunk);
              total += Math.min(chunk.length, remaining);
            }
          });
          res.on("end", () => {
            let bodyHint: string | undefined;
            try {
              const text = Buffer.concat(chunks).toString("utf-8").trim();
              if (text.length > 0) {
                bodyHint =
                  text.length > RESPONSE_BODY_HINT_MAX_LENGTH
                    ? `${text.slice(0, RESPONSE_BODY_HINT_MAX_LENGTH)}…`
                    : text;
              }
            } catch {
              /* body is best-effort context only */
            }
            const headersHint = pickSafeHeaders(res.headers);
            const contentType = headersHint["content-type"];
            const dlErr = new DownloadHttpError({
              message:
                `Download failed: HTTP ${status}${
                  res.statusMessage ? ` ${res.statusMessage}` : ""
                } from ${parsedUrl.host} (${ctx.purpose})`,
              status,
              statusText: res.statusMessage ?? "",
              purpose: ctx.purpose,
              initialUrl,
              finalUrl: urlStr,
              host: parsedUrl.host,
              redirectChain,
              contentType,
              bodyHint,
              headersHint,
              phase: ctx.phase,
              pct: ctx.pct,
            });
            console.error(
              `[install-manager] download failed:\n${renderDownloadErrorDetails(dlErr)}`,
            );
            reject(dlErr);
          });
          res.on("error", reject);
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] ?? "0", 10) || 0;
        let receivedBytes = 0;

        const fileStream = createWriteStream(destPath);

        console.log(
          `[install-manager] download response purpose=${ctx.purpose} ` +
            `status=${status} host=${parsedUrl.host} ` +
            `contentType=${res.headers["content-type"] ?? "?"} ` +
            `contentLength=${totalBytes || "unknown"} ` +
            `redirects=${redirectChain.length - 1}`,
        );

        res.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          onData(receivedBytes, totalBytes);
        });

        res.pipe(fileStream);
        fileStream.on("finish", () => {
          console.log(
            `[install-manager] download complete purpose=${ctx.purpose} ` +
              `bytes=${receivedBytes} host=${parsedUrl.host}`,
          );
          resolve();
        });
        fileStream.on("error", reject);
        res.on("error", reject);
      });

      req.on("error", reject);
    }

    get(url, 0);
  });
}

/**
 * Compute the SHA-256 digest of a file as a lower-case hex string.
 */
function computeSha256(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk: Buffer) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Extract a ZIP archive to `targetDir`.
 *
 * We use `execFile` (not `exec`) to avoid shell interpretation — each
 * argument is passed directly to the child process without shell expansion,
 * which prevents path-injection attacks even if a path contains special chars.
 *
 * On macOS/Linux we call the system `unzip` utility.
 * On Windows we call `powershell.exe` with `Expand-Archive`.
 */
async function extractZip(zipPath: string, targetDir: string): Promise<void> {
  mkdirSync(targetDir, { recursive: true });
  if (process.platform === "win32") {
    // execFile with powershell: pass -Command as a single string arg,
    // but construct the command so paths are only expanded by PS, not the shell.
    await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${targetDir.replace(/'/g, "''")}' -Force`,
    ]);
  } else {
    // unzip: pass -o (overwrite), then zipPath and destination as separate args.
    await execFileAsync("unzip", ["-o", zipPath, "-d", targetDir]);
  }
}

/**
 * Extract a gzip-compressed tar archive (.tar.gz / .tgz) to `targetDir`.
 *
 * Uses the system `tar` utility on every platform — it's available on
 * macOS, Linux, and Windows 10 (1803)+ / Windows 11. Args are passed via
 * `execFile` (no shell), avoiding any path-injection risk.
 */
async function extractTarGz(tarPath: string, targetDir: string): Promise<void> {
  mkdirSync(targetDir, { recursive: true });
  await execFileAsync("tar", ["-xzf", tarPath, "-C", targetDir]);
}

/**
 * Dispatch to the correct extractor based on the archive extension we
 * recorded when selecting the release asset.
 */
async function extractRuntimeArchive(
  archivePath: string,
  archiveExt: string,
  targetDir: string,
): Promise<void> {
  if (archiveExt === ".zip") {
    await extractZip(archivePath, targetDir);
  } else if (archiveExt === ".tar.gz" || archiveExt === ".tgz") {
    await extractTarGz(archivePath, targetDir);
  } else {
    throw new Error(
      `Unsupported runtime archive extension "${archiveExt}". ` +
        `Expected one of: .zip, .tar.gz, .tgz.`,
    );
  }
}

/**
 * Recursively walk `dir` and return the first file whose base name matches
 * `name` (case-sensitive).  Returns `null` when nothing is found.
 */
function findFileRecursive(dir: string, name: string): string | null {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFileRecursive(fullPath, name);
      if (found) return found;
    } else if (entry.name === name) {
      return fullPath;
    }
  }
  return null;
}

/**
 * Names of `.dylib` files that MUST be present in the macOS runtime
 * directory for `llama-server` to load.  These are the exact `@rpath/*`
 * basenames the binary is linked against (see `otool -L llama-server`),
 * NOT the un-versioned aliases.  llama.cpp's macOS release tarball
 * ships each one as a symlink chain:
 *
 *   libllama-common.dylib  → libllama-common.0.dylib
 *   libllama-common.0.dylib → libllama-common.0.0.<build>.dylib  (real file)
 *
 * If our copy step drops the symlink and only keeps the real file (the
 * exact bug this commit fixes), dyld aborts with
 * "Library not loaded: @rpath/libllama-common.0.dylib".  Listing each
 * required `@rpath` name explicitly here means we can detect a partial
 * install BEFORE spawn and surface the missing names by name.
 *
 * Treated as a *minimum* — the validator also accepts dependencies
 * discovered dynamically by `otool -L` for forward-compatibility with
 * future llama.cpp builds that add new dylibs.
 */
const REQUIRED_MACOS_RUNTIME_DYLIBS: readonly string[] = [
  "libllama.0.dylib",
  "libllama-common.0.dylib",
  "libggml.0.dylib",
  "libggml-base.0.dylib",
  "libggml-cpu.0.dylib",
];

/**
 * Return the list of basename entries (files + symlinks + dirs) present
 * in `runtimeDir`, sorted.  Used by diagnostics to surface "actual
 * runtime directory contents" when validation fails.  Returns an empty
 * array on any error so the caller never has to wrap in try/catch.
 */
export function listRuntimeDirContents(runtimeDir: string): string[] {
  try {
    return readdirSync(runtimeDir).slice().sort();
  } catch {
    return [];
  }
}

/**
 * Return `true` when an entry with name `name` exists in `dir` — even
 * when that entry is a broken symlink.  We use `lstatSync` instead of
 * `existsSync` because `existsSync` follows symlinks and returns false
 * for a broken link, which would mis-report a present-but-broken dylib
 * as "missing".  The validator that runs after install needs to count
 * broken links as present (the link itself is what dyld resolves).
 */
function entryExists(dir: string, name: string): boolean {
  try {
    lstatSync(join(dir, name));
    return true;
  } catch {
    return false;
  }
}

/**
 * Return the subset of {@link REQUIRED_MACOS_RUNTIME_DYLIBS} that are
 * NOT present in `runtimeDir`.  Empty array means all required dylibs
 * are accounted for.  Always returns `[]` on non-darwin platforms.
 */
export function findMissingMacRuntimeDylibs(runtimeDir: string): string[] {
  if (process.platform !== "darwin") return [];
  return REQUIRED_MACOS_RUNTIME_DYLIBS.filter((name) => !entryExists(runtimeDir, name));
}

/**
 * Result of {@link validateMacRuntimeDependencies}.
 *
 *  - `ok`            — true when every required dylib is present AND every
 *                       `@rpath/*` dep reported by `otool -L` resolves.
 *  - `missing`       — required `@rpath` basenames missing from `runtimeDir`
 *                       (union of the static minimum list and the dynamic
 *                       `otool -L` dependency list).
 *  - `rpathDeps`     — full list of `@rpath/*` basenames `otool -L` reported
 *                       for `llama-server` (for diagnostics).
 *  - `otoolAvailable` — false when `otool` could not be executed (e.g. on a
 *                       system without Xcode CLT) — the static dylib presence
 *                       check still ran and `missing` is still authoritative.
 */
export interface MacRuntimeDependencyCheck {
  ok: boolean;
  missing: string[];
  rpathDeps: string[];
  otoolAvailable: boolean;
}

/**
 * Verify that every dynamic library `llama-server` is linked against
 * via `@rpath/...` exists alongside it in `runtimeDir`.
 *
 * On darwin we run `otool -L <runtimeDir>/llama-server`, parse every
 * line whose first token starts with `@rpath/`, take the basename, and
 * confirm an entry of that name exists in `runtimeDir`.  Combined with
 * the static {@link REQUIRED_MACOS_RUNTIME_DYLIBS} list this catches
 * both:
 *
 *  1. The exact symlink-drop bug that triggered this fix (e.g.
 *     `libllama-common.0.dylib` symlink missing, only the
 *     `libllama-common.0.0.<build>.dylib` real file present).
 *  2. Any new llama.cpp dylib added in a future release that we
 *     haven't enumerated explicitly.
 *
 * On non-darwin platforms returns `{ ok: true, missing: [], rpathDeps: [],
 * otoolAvailable: false }` — Windows/Linux builds are statically linked.
 */
export async function validateMacRuntimeDependencies(
  runtimeDir: string,
): Promise<MacRuntimeDependencyCheck> {
  if (process.platform !== "darwin") {
    return { ok: true, missing: [], rpathDeps: [], otoolAvailable: false };
  }

  const binaryPath = join(runtimeDir, RUNTIME_BINARY_NAME);
  const staticMissing = findMissingMacRuntimeDylibs(runtimeDir);

  let rpathDeps: string[] = [];
  let otoolAvailable = false;
  try {
    const { stdout } = await execFileAsync("otool", ["-L", binaryPath]);
    otoolAvailable = true;
    // otool -L output:
    //   <binary>:
    //   \t@rpath/libllama.0.dylib (compatibility version 0.0.0, current version 0.0.0)
    //   \t@rpath/libggml.0.dylib (...)
    //   \t/usr/lib/libSystem.B.dylib (...)
    // We only care about local @rpath/* deps; system /usr/lib/* deps are
    // resolved by macOS and not our concern.
    for (const rawLine of stdout.split("\n")) {
      const line = rawLine.trim();
      if (!line.startsWith("@rpath/")) continue;
      const firstToken = line.split(/\s+/)[0];
      // basename of @rpath/foo/bar/libxxx.dylib
      const base = firstToken.split("/").pop();
      if (base) rpathDeps.push(base);
    }
    // De-dupe while preserving order.
    rpathDeps = Array.from(new Set(rpathDeps));
  } catch (err) {
    console.warn(
      `[install-manager] otool -L failed for ${binaryPath}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const dynamicMissing = rpathDeps.filter((name) => !entryExists(runtimeDir, name));
  const missing = Array.from(new Set([...staticMissing, ...dynamicMissing])).sort();

  return {
    ok: missing.length === 0,
    missing,
    rpathDeps,
    otoolAvailable,
  };
}

/**
 * Return `true` when the runtime directory contains a complete runtime
 * installation — binary present AND (on macOS) every required
 * `@rpath/*.dylib` companion library present (real file or symlink).
 *
 * On macOS, llama.cpp ships as a set of dynamically-linked files: the
 * `llama-server` binary plus several `.dylib` libraries (e.g.
 * `libllama-common.0.dylib`, `libggml.0.dylib`) packaged as symlink
 * chains.  A legacy install that only copied the binary — OR an install
 * that copied the real dylib files but dropped the `.0.dylib` symlinks
 * dyld actually resolves — is incomplete and will immediately abort
 * with `dyld: Library not loaded` at process start.  Detecting this
 * early lets the install pipeline skip the "already installed"
 * short-circuit and always produce a complete installation.
 *
 * On Windows and Linux, the llama.cpp builds targeted by this project
 * are statically linked, so the binary alone is sufficient.
 */
function isRuntimeInstallComplete(runtimeDir: string): boolean {
  try {
    const entries = readdirSync(runtimeDir);
    const hasBinary = entries.includes(RUNTIME_BINARY_NAME);
    if (!hasBinary) return false;
    if (process.platform === "darwin") {
      return findMissingMacRuntimeDylibs(runtimeDir).length === 0;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Copy every regular file AND every symbolic link from `srcDir` into
 * `destDir`, overwriting any existing entry of the same name.
 * Sub-directories inside `srcDir` are intentionally skipped — the
 * llama.cpp release archives for macOS place all required files (binary
 * + dylibs) flat in a single directory, so a flat copy is correct.
 *
 * Symlinks MUST be preserved verbatim on macOS: the release tarball
 * ships dylibs as a chain
 *
 *   libllama-common.dylib   → libllama-common.0.dylib
 *   libllama-common.0.dylib → libllama-common.0.0.<build>.dylib   (real file)
 *
 * and `llama-server` is linked against the symlink name
 * `@rpath/libllama-common.0.dylib`.  An earlier version of this helper
 * skipped non-`isFile()` entries, dropping every symlink, which left
 * only the versioned real file behind and caused dyld to abort on
 * spawn.  We now `symlinkSync(readlinkSync(src), dest)` to recreate
 * each link with the same target string the archive shipped — both
 * relative-target links (`libllama-common.0.dylib`) and absolute-target
 * links round-trip correctly because we copy the link's target *string*
 * unchanged.  If symlink creation fails (e.g. on a Windows volume that
 * forbids unprivileged symlinks) we fall back to copying the resolved
 * target file under the link's name.
 *
 * Used instead of a rename/move so the operation is safe across
 * filesystem boundaries (e.g. when the tmp extract dir and the managed
 * runtime dir are on different volumes).
 */
function copyRuntimeFiles(srcDir: string, destDir: string): void {
  mkdirSync(destDir, { recursive: true });
  const entries = readdirSync(srcDir, { withFileTypes: true });
  for (const entry of entries) {
    const src = join(srcDir, entry.name);
    const dest = join(destDir, entry.name);

    // Remove any existing entry at dest (file or broken symlink) so the
    // copy/symlink call doesn't fail with EEXIST.
    try {
      if (existsSync(dest) || lstatSync(dest)) {
        unlinkSync(dest);
      }
    } catch {
      /* dest doesn't exist — fine */
    }

    if (entry.isSymbolicLink()) {
      try {
        const target = readlinkSync(src);
        symlinkSync(target, dest);
      } catch (err) {
        // Fallback: copy the resolved file under the link's name so the
        // dependent binary can still find it by basename.
        try {
          copyFileSync(src, dest);
        } catch {
          console.warn(
            `[install-manager] failed to copy symlink ${entry.name}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } else if (entry.isFile()) {
      copyFileSync(src, dest);
    }
    // Subdirectories intentionally skipped — see jsdoc.
  }
}

/**
 * Recursively list every regular-file/symlink entry under `dir`,
 * returning paths relative to `dir`, sorted.  Used to log the full
 * contents of a freshly-extracted runtime archive so post-mortem
 * diagnostics can confirm whether a missing dylib was actually present
 * in the upstream tarball.  Bounded only by archive size; llama.cpp
 * tarballs are <50 entries so this is safe to log inline.
 */
function listArchiveEntriesRecursive(dir: string): string[] {
  const out: string[] = [];
  const walk = (current: string, prefix: string) => {
    let entries: ReturnType<typeof readdirSync>;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(join(current, entry.name), rel);
      } else {
        const tag = entry.isSymbolicLink() ? "@" : "";
        out.push(`${rel}${tag}`);
      }
    }
  };
  walk(dir, "");
  return out.sort();
}

/**
 * Wipe every entry in `runtimeDir` (files, symlinks, and subdirs).
 * Called by `installRuntimeOnly` (the Repair Runtime path) before
 * re-extracting so a stale install — including the exact bug this
 * commit fixes (real dylib files left behind, symlinks missing) —
 * can't shadow the fresh files.  Best-effort: any per-entry failure
 * is logged and skipped so a single locked file doesn't abort repair.
 *
 * Safe to call on a non-existent or empty dir.
 */
function clearRuntimeDir(runtimeDir: string): void {
  let entries: ReturnType<typeof readdirSync>;
  try {
    entries = readdirSync(runtimeDir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const p = join(runtimeDir, entry.name);
    try {
      if (entry.isDirectory()) {
        rmSync(p, { recursive: true, force: true });
      } else {
        // Covers regular files AND symlinks (incl. broken ones).
        unlinkSync(p);
      }
    } catch (err) {
      console.warn(
        `[install-manager] failed to remove stale runtime entry ${p}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}

// ── Runtime install metadata (for diagnostics) ────────────────────────────────

/** Filename of the runtime install metadata sidecar inside the runtime dir. */
const RUNTIME_META_FILENAME = "runtime-meta.json";

/**
 * Persisted alongside the runtime binary so the diagnostics panel can
 * surface "selected runtime release/asset name" without re-querying the
 * GitHub releases API.  Written at the end of every successful install
 * / repair; read opportunistically — missing/unparseable file is OK and
 * just renders as "unknown".
 */
export interface RuntimeInstallMetadata {
  /** Asset filename selected from the GitHub release (e.g. "llama-b9095-bin-macos-arm64.tar.gz"). */
  assetName: string;
  /** Release tag the asset came from (e.g. "b9095"). */
  tag: string | null;
  /** Wall-clock ms when the install completed. */
  installedAt: number;
  /** process.platform / process.arch tag for cross-checking on first run. */
  platformTag: string;
}

function writeRuntimeMeta(runtimeDir: string, meta: RuntimeInstallMetadata): void {
  try {
    writeFileSync(join(runtimeDir, RUNTIME_META_FILENAME), JSON.stringify(meta, null, 2));
  } catch (err) {
    console.warn(
      `[install-manager] failed to write runtime-meta.json: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Read the runtime install metadata sidecar.  Returns `null` when the
 * file is missing, unreadable, or fails to parse — diagnostics treat
 * that as "unknown" rather than surfacing a noisy error.
 */
export function readRuntimeMeta(runtimeDir: string): RuntimeInstallMetadata | null {
  try {
    const raw = readFileSync(join(runtimeDir, RUNTIME_META_FILENAME), "utf8");
    const parsed = JSON.parse(raw) as RuntimeInstallMetadata;
    if (
      parsed &&
      typeof parsed.assetName === "string" &&
      typeof parsed.installedAt === "number" &&
      typeof parsed.platformTag === "string"
    ) {
      return {
        assetName: parsed.assetName,
        tag: typeof parsed.tag === "string" ? parsed.tag : null,
        installedAt: parsed.installedAt,
        platformTag: parsed.platformTag,
      };
    }
    return null;
  } catch {
    return null;
  }
}

// ── Typed install errors ──────────────────────────────────────────────────────

/**
 * Error thrown by the install pipeline when the llama.cpp runtime release
 * cannot be located.  Wraps the underlying `RuntimeReleaseLookupError`
 * (preserving its `.cause` chain) and surfaces a stable error category
 * that the renderer can map to a friendly UI message.
 */
export class RuntimeReleaseInstallError extends Error {
  override readonly name = "RuntimeReleaseInstallError";
  /** Category propagated from the underlying lookup failure. */
  readonly category: ReleaseLookupErrorCategory;
  /** Pre-rendered cause chain for the technical-details UI section. */
  readonly causeChain: string;
  /** URL that was being contacted when the lookup failed. */
  readonly url: string;
  /** Number of attempts made before giving up. */
  readonly attempts: number;

  constructor(message: string, lookupErr: RuntimeReleaseLookupError) {
    super(message, { cause: lookupErr });
    this.category = lookupErr.category;
    this.causeChain = lookupErr.causeChain;
    this.url = lookupErr.url;
    this.attempts = lookupErr.attempts;
  }
}

/**
 * Error thrown by the install pipeline when an asset download (runtime archive
 * or model GGUF) returns a non-2xx HTTP response.  Wraps a
 * {@link DownloadHttpError} and exposes the same coarse category vocabulary
 * as `RuntimeReleaseInstallError` so the IPC layer can map it to a friendly
 * UI message — most importantly distinguishing the **401/403 "auth-required"**
 * case (gated repo / wrong token) from a generic install failure.
 */
export class AssetDownloadInstallError extends Error {
  override readonly name = "AssetDownloadInstallError";
  /** Coarse category derived from the HTTP status. */
  readonly category: "auth-required" | "rate-limited" | "http-error";
  /** Pre-rendered diagnostic chain for the UI's technical-details section. */
  readonly causeChain: string;
  /** Final URL after redirects — i.e. the request that actually failed. */
  readonly url: string;
  /** Initial URL before any redirects. */
  readonly initialUrl: string;
  /** HTTP status code returned by the server. */
  readonly status: number;
  /** Host that returned the failing response. */
  readonly host: string;
  /** Logical purpose of the failed download. */
  readonly purpose: DownloadPurpose;
  /** Install pipeline phase at the time of failure. */
  readonly phase: OfflineInstallPhase;
  /** Reported pct at the time of failure. */
  readonly pct: number;

  constructor(message: string, dlErr: DownloadHttpError) {
    super(message, { cause: dlErr });
    this.category = classifyDownloadStatus(dlErr.status);
    this.causeChain = renderDownloadErrorDetails(dlErr);
    this.url = dlErr.finalUrl;
    this.initialUrl = dlErr.initialUrl;
    this.status = dlErr.status;
    this.host = dlErr.host;
    this.purpose = dlErr.purpose;
    this.phase = dlErr.phase;
    this.pct = dlErr.pct;
  }
}

// ── Install lock ──────────────────────────────────────────────────────────────

/** True while an install is in progress — prevents concurrent installs. */
let _installing = false;

// ── Install manager ───────────────────────────────────────────────────────────

/**
 * Install manager — the single authoritative implementation of the GHchat
 * offline install pipeline.
 *
 * Pipeline (10 phases):
 *  1. Preflight           — validate catalog entry, platform, disk space
 *  2. Directories         — ensure all offline sub-directories exist
 *  3. Runtime download    — fetch platform llama.cpp server binary (zip) from GitHub
 *  4. Runtime verify      — confirm extracted binary exists and is executable
 *  5. Model download      — stream GGUF file to `downloads/{id}.gguf.tmp`
 *  6. Model verify        — SHA-256 checksum (skipped when sha256 = "pending")
 *  7. Move                — atomic rename tmp → `models/{id}.gguf`
 *  8. Manifest            — write `manifests/{id}.json` with install metadata
 *  9. Register            — persist to DB (offline_models + offline_manifests tables)
 * 10. Smoke test          — confirm file present and size within 50 % of expected
 *
 * Progress (0–100 %) is reported at every meaningful step via `onProgress`.
 * Only one install runs at a time; concurrent calls throw immediately.
 */
export const installManager = {
  /** True while an install is in progress. */
  isInstalling(): boolean {
    return _installing;
  },

  /**
   * Run the full install pipeline for `modelId`.
   * Throws on any error; callers must catch and handle the error state.
   */
  async install(modelId: string, onProgress?: ProgressCallback): Promise<void> {
    if (_installing) {
      throw new Error("An offline install is already in progress");
    }
    _installing = true;

    const report = (
      phase: OfflineInstallPhase,
      step: string,
      pct: number,
      extra?: Pick<OfflineInstallProgress, "downloadedBytes" | "totalBytes" | "speedBps" | "etaSec">,
    ) => {
      onProgress?.({ phase, step, pct, ...extra });
    };

    try {
      // ── 1. Preflight ─────────────────────────────────────────────────────────
      report("preflight", "Checking system requirements…", 1);

      const entry = offlineCatalog.getById(modelId);
      if (!entry) throw new Error(`Unknown catalog model: ${modelId}`);

      if (!(entry.platforms as string[]).includes(process.platform)) {
        throw new Error(
          `${entry.name} does not support platform ${process.platform}`,
        );
      }

      const freeDiskGb = await storageService.availableSpaceGb();
      // Require 10 % more free space than the stated minimum for breathing room.
      if (freeDiskGb < entry.diskRequiredGb * 1.1) {
        throw new Error(
          `Not enough disk space: ${entry.name} requires ${entry.diskRequiredGb} GB, ` +
            `but only ${freeDiskGb.toFixed(1)} GB is free`,
        );
      }

      report("preflight", "System check passed", 3);

      // ── 2. Directories ───────────────────────────────────────────────────────
      storageService.ensureDirectories();

      const runtimeDir = storageService.getSubdir("runtime");
      const modelsDir = storageService.getSubdir("models");
      const downloadsDir = storageService.getSubdir("downloads");
      const manifestsDir = storageService.getSubdir("manifests");
      const tmpDir = storageService.getSubdir("tmp");

      const runtimeBinPath = join(runtimeDir, RUNTIME_BINARY_NAME);
      // Archive extension is decided dynamically per release (see runtime-catalog
      // selection rule). The tmp filename is therefore generic; the real
      // extension is recorded on the release info object below.
      const runtimeArchiveTmp = join(downloadsDir, "llama-runtime.archive.tmp");
      const runtimeExtractDir = join(tmpDir, "llama-extract");

      const tmpPath = join(downloadsDir, `${modelId}.gguf.tmp`);
      const modelPath = join(modelsDir, `${modelId}.gguf`);
      const manifestPath = join(manifestsDir, `${modelId}.json`);

      // ── 3. Download runtime binary ───────────────────────────────────────────
      // Skip only when the runtime installation is complete — binary present
      // AND (on macOS) all required .dylib companion libraries present.
      // A legacy install that only copied the binary is treated as incomplete
      // so the download+extract path runs again and produces a full install.
      if (!isRuntimeInstallComplete(runtimeDir)) {
        report("downloading-runtime", "Looking up latest llama.cpp release…", 4);

        let runtimeDownloadUrl: string;
        let runtimeSizeBytes: number;
        let runtimeArchiveExt: string;
        let runtimeAssetName: string;
        let runtimeReleaseTag: string;
        try {
          const release = await fetchLatestRuntimeRelease();
          runtimeDownloadUrl = release.downloadUrl;
          runtimeSizeBytes = release.sizeBytes;
          runtimeArchiveExt = release.archiveExt;
          runtimeAssetName = release.assetName;
          runtimeReleaseTag = release.tag;
          const sourceLabel =
            release.source === "pinned-fallback"
              ? " (using pinned fallback — GitHub API unreachable)"
              : "";
          report(
            "downloading-runtime",
            `Downloading runtime ${release.tag} (${getRuntimePlatformTag()}: ${runtimeAssetName})${sourceLabel}…`,
            5,
          );
        } catch (err) {
          // Preserve the original error (and its full `.cause` chain) so that
          // callers / IPC consumers can inspect ENOTFOUND / ECONNRESET / TLS /
          // proxy details instead of seeing only an opaque "fetch failed".
          // We still log the rendered chain here so it shows up in main-process
          // logs even if the renderer only displays the top-level message.
          console.error(
            "[install-manager] runtime release lookup failed:\n  " +
              formatErrorChain(err),
          );
          if (err instanceof RuntimeReleaseLookupError) {
            // Surface the structured category so the UI can render a friendly
            // message; the underlying error is preserved as `.cause`.
            throw new RuntimeReleaseInstallError(
              `Failed to locate llama.cpp runtime release: ${err.message}`,
              err,
            );
          }
          throw new Error(
            `Failed to locate llama.cpp runtime release: ${err instanceof Error ? err.message : String(err)}`,
            { cause: err },
          );
        }

        // Clean up any partial previous download.
        if (existsSync(runtimeArchiveTmp)) unlinkSync(runtimeArchiveTmp);

        const rtDownloadStart = Date.now();
        try {
          await downloadFile(
            runtimeDownloadUrl,
            runtimeArchiveTmp,
            (received, total) => {
              // Runtime download maps to 5–22 % range.
              const dlPct = total > 0 ? received / total : 0;
              const pct = 5 + Math.round(dlPct * 17);
              const kb = (received / 1024).toFixed(0);
              const totalKb =
                total > 0 ? ` / ${Math.round(total / 1024)} KB` : "";

              const elapsedSec = (Date.now() - rtDownloadStart) / 1000;
              let speedBps: number | undefined;
              let etaSec: number | undefined;
              if (elapsedSec >= 0.5 && received >= 64 * 1024) {
                speedBps = received / elapsedSec;
                if (speedBps > 0 && total > received) {
                  etaSec = Math.round((total - received) / speedBps);
                }
              }

              report(
                "downloading-runtime",
                `Downloading runtime… ${kb} KB${totalKb}`,
                pct,
                {
                  downloadedBytes: received,
                  totalBytes: total > 0 ? total : runtimeSizeBytes || undefined,
                  speedBps,
                  etaSec,
                },
              );
            },
            { purpose: "runtime", phase: "downloading-runtime", pct: 5 },
          );
        } catch (err) {
          if (err instanceof DownloadHttpError) {
            // Surface a clear failure step text so the renderer's progress
            // bar doesn't visually freeze on the last "Downloading…" line.
            report(
              "downloading-runtime",
              `Runtime download failed: HTTP ${err.status} from ${err.host}`,
              Math.max(5, err.pct),
            );
            throw new AssetDownloadInstallError(
              `Runtime download failed: HTTP ${err.status} from ${err.host}`,
              err,
            );
          }
          throw err;
        }

        report("downloading-runtime", "Runtime download complete", 22);

        // ── 4. Extract and verify runtime binary ─────────────────────────────────
        report("verifying-runtime", "Extracting runtime…", 23);

        await extractRuntimeArchive(runtimeArchiveTmp, runtimeArchiveExt, runtimeExtractDir);

        // Log the full extracted archive contents so post-mortem
        // diagnostics can prove which dylibs were/weren't in the upstream
        // tarball.  Bounded by archive size (<50 entries for llama.cpp).
        const archiveEntries = listArchiveEntriesRecursive(runtimeExtractDir);
        console.log(
          `[install-manager] runtime archive ${runtimeAssetName} extracted ` +
            `(${archiveEntries.length} entries):\n  ` +
            archiveEntries.join("\n  "),
        );

        const extractedBin = findFileRecursive(runtimeExtractDir, RUNTIME_BINARY_NAME);
        if (!extractedBin) {
          throw new Error(
            `llama-server binary not found inside the downloaded archive. ` +
              `This may indicate a release asset naming change — please file a bug.`,
          );
        }

        // Copy ALL files (regular files AND symlinks) from the directory
        // containing the binary to the managed runtime dir.  On macOS,
        // llama.cpp archives ship as a flat directory of the binary plus
        // required `.dylib` files, where each linkable name (e.g.
        // `libllama-common.0.dylib`) is itself a SYMLINK to the versioned
        // real file (`libllama-common.0.0.<build>.dylib`).  An earlier
        // version of `copyRuntimeFiles` filtered out non-`isFile()`
        // entries, dropping every symlink and leaving only the versioned
        // real files behind, causing dyld to abort with
        // "Library not loaded: @rpath/libllama-common.0.dylib" at process
        // start.  The current implementation re-creates symlinks verbatim.
        const extractedBinDir = dirname(extractedBin);
        copyRuntimeFiles(extractedBinDir, runtimeDir);

        // Make the binary executable on Unix.
        if (process.platform !== "win32") {
          chmodSync(runtimeBinPath, 0o755);
        }

        // On macOS, remove the quarantine extended attribute that Gatekeeper
        // adds to files downloaded from the internet.  Without this the OS
        // would refuse to run unsigned binaries or prompt the user.  Apply
        // to the entire runtime dir so both the binary and every .dylib are
        // cleared in one pass.
        if (process.platform === "darwin") {
          try {
            // execFile: no shell — args passed directly, no injection risk.
            await execFileAsync("xattr", ["-dr", "com.apple.quarantine", runtimeDir]);
          } catch {
            // Not fatal — the binary may still work if the user approved it.
            console.warn(
              "[installManager] could not remove quarantine attribute from runtime dir",
            );
          }
        }

        // Hard validation: on macOS, confirm every required dylib (and
        // every `@rpath/*` dep `otool -L` reports) actually resolves
        // inside the runtime dir BEFORE we declare the install
        // successful.  Failing here aborts the install with a precise
        // missing-library list — much more actionable than waiting for
        // dyld to SIGABRT the spawn at first chat attempt.
        if (process.platform === "darwin") {
          const depCheck = await validateMacRuntimeDependencies(runtimeDir);
          if (!depCheck.ok) {
            const dirContents = listRuntimeDirContents(runtimeDir);
            throw new Error(
              `Runtime install incomplete — missing required dynamic libraries on macOS: ` +
                `${depCheck.missing.join(", ")}. ` +
                `Asset "${runtimeAssetName}" was extracted but copy step did not preserve all dylibs. ` +
                `Runtime dir contents: ${dirContents.join(", ")}.`,
            );
          }
          console.log(
            `[install-manager] macOS runtime dependency check OK ` +
              `(${depCheck.rpathDeps.length} @rpath deps resolved)`,
          );
        }

        // Persist install metadata for the diagnostics panel ("selected
        // runtime release / asset name").
        writeRuntimeMeta(runtimeDir, {
          assetName: runtimeAssetName,
          tag: runtimeReleaseTag,
          installedAt: Date.now(),
          platformTag: getRuntimePlatformTag(),
        });

        // Clean up the archive and extract dir using Node.js fs (no shell needed).
        try {
          if (existsSync(runtimeArchiveTmp)) unlinkSync(runtimeArchiveTmp);
          if (existsSync(runtimeExtractDir)) {
            rmSync(runtimeExtractDir, { recursive: true, force: true });
          }
        } catch {
          // Best-effort cleanup.
        }

        report("verifying-runtime", "Runtime ready", 25);
      } else {
        // Runtime already completely installed — skip the download but still
        // report the phases so the UI phase list is consistent.
        report("downloading-runtime", "Runtime already installed", 22);
        report("verifying-runtime", "Runtime verified", 25);
      }

      // ── 5. Download model ────────────────────────────────────────────────────
      // Clean up any previous partial download.
      if (existsSync(tmpPath)) unlinkSync(tmpPath);

      report("downloading-model", "Connecting to download server…", 27);

      const downloadStartMs = Date.now();
      try {
        await downloadFile(
          entry.downloadUrl,
          tmpPath,
          (received, total) => {
            // Map download progress to the 27–88 % range.
            const dlPct = total > 0 ? received / total : 0;
            const pct = 27 + Math.round(dlPct * 61);
            const mb = (received / (1024 * 1024)).toFixed(0);
            const totalMb = total > 0 ? ` / ${(total / (1024 * 1024)).toFixed(0)} MB` : "";

            // Speed and ETA — only meaningful once at least 500 ms have elapsed and
            // 64 KB have arrived, to avoid wildly inflated estimates at startup.
            const elapsedSec = (Date.now() - downloadStartMs) / 1000;
            const minElapsedSec = 0.5;
            const minReceivedBytes = 64 * 1024;
            let speedBps: number | undefined;
            let etaSec: number | undefined;
            if (elapsedSec >= minElapsedSec && received >= minReceivedBytes) {
              speedBps = received / elapsedSec;
              if (speedBps > 0 && total > received) {
                etaSec = Math.round((total - received) / speedBps);
              }
            }

            report(
              "downloading-model",
              `Downloading ${entry.name}… ${mb} MB${totalMb}`,
              pct,
              {
                downloadedBytes: received,
                totalBytes: total > 0 ? total : undefined,
                speedBps,
                etaSec,
              },
            );
          },
          { purpose: "model", phase: "downloading-model", pct: 27 },
        );
      } catch (err) {
        // Clean up the partial download so a retry isn't biased by stale bytes
        // and so disk usage doesn't drift on repeated failures.
        try {
          if (existsSync(tmpPath)) unlinkSync(tmpPath);
        } catch {
          /* best-effort */
        }

        if (err instanceof DownloadHttpError) {
          // Emit a concrete failure progress event so the InstallingScreen
          // immediately reflects the failure (instead of remaining stuck on
          // the last "Downloading…" line) before the IPC layer transitions
          // the readiness state to "install-failed".
          report(
            "downloading-model",
            `Model download failed: HTTP ${err.status} from ${err.host}`,
            Math.max(27, err.pct),
          );
          throw new AssetDownloadInstallError(
            `Model download failed: HTTP ${err.status} from ${err.host} ` +
              `(${entry.name})`,
            err,
          );
        }
        throw err;
      }

      report("downloading-model", "Download complete", 88);

      // ── 6. Verify model checksum ─────────────────────────────────────────────
      report("verifying-model", "Verifying file integrity…", 89);

      if (entry.sha256 !== "pending") {
        const actualHash = await computeSha256(tmpPath);
        if (actualHash !== entry.sha256) {
          unlinkSync(tmpPath);
          throw new Error(
            `Integrity check failed for ${entry.name}: ` +
              `expected ${entry.sha256}, got ${actualHash}. ` +
              `The downloaded file may be corrupt — please retry.`,
          );
        }
      }
      // When sha256 = "pending" we skip the check and trust the download.

      report("verifying-model", "Integrity check passed", 91);

      // ── 7. Move to managed storage ───────────────────────────────────────────
      report("finalizing", "Installing model file…", 92);

      // Remove any pre-existing model file (handles reinstall / repair case).
      if (existsSync(modelPath)) unlinkSync(modelPath);
      renameSync(tmpPath, modelPath);

      // ── 8. Write manifest JSON ───────────────────────────────────────────────
      report("finalizing", "Writing install manifest…", 93);

      const manifest = {
        id: entry.id,
        name: entry.name,
        variantLabel: entry.variantLabel,
        version: entry.version,
        quantization: entry.quantization,
        sizeGb: entry.sizeGb,
        modelPath,
        installedAt: Date.now(),
      };
      writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), "utf-8");

      // ── 9. Register in DB ────────────────────────────────────────────────────
      report("finalizing", "Registering model in database…", 95);

      modelRegistry.register({
        id: entry.id,
        name: entry.name,
        sizeGb: entry.sizeGb,
        quantization: entry.quantization,
        modelPath,
        manifestPath,
      });

      // Record each managed file in the manifests table for clean-up tracking.
      if (isDatabaseReady()) {
        try {
          const modelStat = statSync(modelPath);
          addOfflineManifestEntry({
            ownerType: "model",
            ownerId: entry.id,
            filePath: modelPath,
            sizeBytes: modelStat.size,
          });
          addOfflineManifestEntry({
            ownerType: "model",
            ownerId: entry.id,
            filePath: manifestPath,
          });
        } catch (err) {
          // Manifest tracking is best-effort; don't fail the install for it.
          console.warn("[installManager] manifest entry write failed:", err);
        }
      }

      // ── 10. Smoke test ───────────────────────────────────────────────────────
      report("smoke-test", "Verifying install…", 97);

      if (!existsSync(modelPath)) {
        throw new Error(
          "Model file is missing after installation — the install may be corrupt",
        );
      }

      const installedStat = statSync(modelPath);
      const installedGb = installedStat.size / BYTES_PER_GB;
      if (installedGb < entry.sizeGb * 0.5) {
        throw new Error(
          `Model file appears incomplete: expected ~${entry.sizeGb.toFixed(1)} GB, ` +
            `found ${installedGb.toFixed(1)} GB`,
        );
      }

      // Verify the runtime installation is complete (binary + dylibs on macOS).
      if (!isRuntimeInstallComplete(runtimeDir)) {
        throw new Error(
          "Runtime installation is incomplete after install — please retry the install.",
        );
      }

      report("smoke-test", "Installation complete", 100);
    } finally {
      _installing = false;
    }
  },

  /**
   * Check whether the current offline installation is intact.
   *
   * Verifies:
   *  - At least one model is registered in the DB
   *  - The model `.gguf` file exists and is ≥ 50 % of its declared size
   *  - The runtime binary exists on disk
   *
   * Returns `{ok: true}` on success, or `{ok: false, reason}` when something
   * is wrong so callers can branch without catching exceptions.
   *
   * Safe to call at any time; never throws.
   */
  verifyIntegrity(): { ok: boolean; reason?: string } {
    try {
      if (!isDatabaseReady()) {
        return { ok: false, reason: "Database not available" };
      }

      // Must have at least one registered model.
      const models = modelRegistry.listInstalled();
      if (models.length === 0) {
        return { ok: false, reason: "No offline model registered in database" };
      }

      const model = models[0];

      // Model file must exist.
      if (!existsSync(model.modelPath)) {
        return { ok: false, reason: `Model file missing: ${model.modelPath}` };
      }

      // Model file must be at least 50 % of the declared size to rule out
      // a truncated / interrupted download that was never cleaned up.
      const modelStat = statSync(model.modelPath);
      const minBytes = model.sizeGb * BYTES_PER_GB * 0.5;
      if (modelStat.size < minBytes) {
        return {
          ok: false,
          reason:
            `Model file appears incomplete: expected ~${model.sizeGb.toFixed(1)} GB, ` +
            `found ${(modelStat.size / BYTES_PER_GB).toFixed(1)} GB`,
        };
      }

      // Runtime binary must exist and installation must be complete
      // (on macOS this requires every required `.dylib` symlink target
      // alongside the binary).
      const runtimeDir = storageService.getSubdir("runtime");
      if (!isRuntimeInstallComplete(runtimeDir)) {
        const runtimeBinPath = join(runtimeDir, RUNTIME_BINARY_NAME);
        if (!existsSync(runtimeBinPath)) {
          return { ok: false, reason: "Runtime binary missing — the runtime must be reinstalled" };
        }
        const missing = findMissingMacRuntimeDylibs(runtimeDir);
        const missingHint = missing.length
          ? ` Missing: ${missing.join(", ")}.`
          : "";
        return {
          ok: false,
          reason:
            "Runtime installation is incomplete (required .dylib files are missing on macOS) — " +
            `the runtime must be reinstalled.${missingHint}`,
        };
      }

      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: `Integrity check error: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },

  /**
   * Check whether a single registered model's files are intact on disk.
   *
   * Returns:
   *   - { ok: true, sizeBytes } when the file exists and its size is at
   *     least 50 % of the declared size.
   *   - { ok: false, health: "missing", sizeBytes: 0 } when the file is gone.
   *   - { ok: false, health: "incomplete", sizeBytes } when the file exists
   *     but is suspiciously small.
   *   - { ok: false, health: "unknown", sizeBytes: 0 } on stat error.
   *
   * Never throws.
   */
  verifyModel(
    modelId: string,
  ): {
    ok: boolean;
    health: "ok" | "missing" | "incomplete" | "unknown";
    sizeBytes: number;
    reason?: string;
  } {
    try {
      const record = modelRegistry.listInstalled().find((m) => m.id === modelId);
      if (!record) {
        return { ok: false, health: "unknown", sizeBytes: 0, reason: "Not registered in DB" };
      }
      if (!existsSync(record.modelPath)) {
        return {
          ok: false,
          health: "missing",
          sizeBytes: 0,
          reason: `Model file missing: ${record.modelPath}`,
        };
      }
      const stat = statSync(record.modelPath);
      const minBytes = record.sizeGb * BYTES_PER_GB * 0.5;
      if (stat.size < minBytes) {
        return {
          ok: false,
          health: "incomplete",
          sizeBytes: stat.size,
          reason:
            `Model file appears incomplete: expected ~${record.sizeGb.toFixed(1)} GB, ` +
            `found ${(stat.size / BYTES_PER_GB).toFixed(2)} GB`,
        };
      }
      return { ok: true, health: "ok", sizeBytes: stat.size };
    } catch (err) {
      return {
        ok: false,
        health: "unknown",
        sizeBytes: 0,
        reason: err instanceof Error ? err.message : String(err),
      };
    }
  },

  /** True when the runtime binary exists on disk. */
  isRuntimeBinaryPresent(): boolean {
    try {
      return existsSync(join(storageService.getSubdir("runtime"), RUNTIME_BINARY_NAME));
    } catch {
      return false;
    }
  },

  /**
   * True when the runtime installation is complete — binary present and (on
   * macOS) required `.dylib` files are also present alongside the binary.
   * A legacy install that only placed the binary is treated as incomplete.
   */
  isRuntimeInstallComplete(): boolean {
    return isRuntimeInstallComplete(storageService.getSubdir("runtime"));
  },

  /**
   * Download, extract, and install the llama.cpp runtime for the current
   * platform — without touching any installed models.
   *
   * This is the "Repair Runtime" path: it wipes the existing runtime dir
   * contents (if any), re-downloads the archive, extracts it, and copies
   * all runtime files (binary + .dylib files on macOS) into the runtime dir.
   *
   * Throws on any error; callers must catch and handle the error state.
   * Never touches model .gguf files, manifests, or DB records.
   */
  async installRuntimeOnly(onProgress?: ProgressCallback): Promise<void> {
    if (_installing) {
      throw new Error("An offline install is already in progress");
    }
    _installing = true;

    const report = (
      phase: OfflineInstallPhase,
      step: string,
      pct: number,
      extra?: Pick<OfflineInstallProgress, "downloadedBytes" | "totalBytes" | "speedBps" | "etaSec">,
    ) => {
      onProgress?.({ phase, step, pct, ...extra });
    };

    try {
      report("preflight", "Preparing runtime reinstall…", 1);

      storageService.ensureDirectories();

      const runtimeDir = storageService.getSubdir("runtime");
      const downloadsDir = storageService.getSubdir("downloads");
      const tmpDir = storageService.getSubdir("tmp");

      const runtimeBinPath = join(runtimeDir, RUNTIME_BINARY_NAME);
      const runtimeArchiveTmp = join(downloadsDir, "llama-runtime.archive.tmp");
      const runtimeExtractDir = join(tmpDir, "llama-extract");

      report("downloading-runtime", "Looking up latest llama.cpp release…", 4);

      let runtimeDownloadUrl: string;
      let runtimeSizeBytes: number;
      let runtimeArchiveExt: string;
      let runtimeAssetName: string;
      let runtimeReleaseTag: string;
      try {
        const release = await fetchLatestRuntimeRelease();
        runtimeDownloadUrl = release.downloadUrl;
        runtimeSizeBytes = release.sizeBytes;
        runtimeArchiveExt = release.archiveExt;
        runtimeAssetName = release.assetName;
        runtimeReleaseTag = release.tag;
        const sourceLabel =
          release.source === "pinned-fallback"
            ? " (using pinned fallback — GitHub API unreachable)"
            : "";
        report(
          "downloading-runtime",
          `Downloading runtime ${release.tag} (${getRuntimePlatformTag()}: ${runtimeAssetName})${sourceLabel}…`,
          5,
        );
      } catch (err) {
        console.error(
          "[install-manager] runtime release lookup failed:\n  " +
            formatErrorChain(err),
        );
        if (err instanceof RuntimeReleaseLookupError) {
          throw new RuntimeReleaseInstallError(
            `Failed to locate llama.cpp runtime release: ${err.message}`,
            err,
          );
        }
        throw new Error(
          `Failed to locate llama.cpp runtime release: ${err instanceof Error ? err.message : String(err)}`,
          { cause: err },
        );
      }

      if (existsSync(runtimeArchiveTmp)) unlinkSync(runtimeArchiveTmp);

      const rtDownloadStart = Date.now();
      try {
        await downloadFile(
          runtimeDownloadUrl,
          runtimeArchiveTmp,
          (received, total) => {
            const dlPct = total > 0 ? received / total : 0;
            const pct = 5 + Math.round(dlPct * 85);
            const kb = (received / 1024).toFixed(0);
            const totalKb = total > 0 ? ` / ${Math.round(total / 1024)} KB` : "";
            const elapsedSec = (Date.now() - rtDownloadStart) / 1000;
            let speedBps: number | undefined;
            let etaSec: number | undefined;
            if (elapsedSec >= 0.5 && received >= 64 * 1024) {
              speedBps = received / elapsedSec;
              if (speedBps > 0 && total > received) {
                etaSec = Math.round((total - received) / speedBps);
              }
            }
            report(
              "downloading-runtime",
              `Downloading runtime… ${kb} KB${totalKb}`,
              pct,
              {
                downloadedBytes: received,
                totalBytes: total > 0 ? total : runtimeSizeBytes || undefined,
                speedBps,
                etaSec,
              },
            );
          },
          { purpose: "runtime", phase: "downloading-runtime", pct: 5 },
        );
      } catch (err) {
        if (err instanceof DownloadHttpError) {
          report(
            "downloading-runtime",
            `Runtime download failed: HTTP ${err.status} from ${err.host}`,
            Math.max(5, err.pct),
          );
          throw new AssetDownloadInstallError(
            `Runtime download failed: HTTP ${err.status} from ${err.host}`,
            err,
          );
        }
        throw err;
      }

      report("verifying-runtime", "Extracting runtime…", 92);

      await extractRuntimeArchive(runtimeArchiveTmp, runtimeArchiveExt, runtimeExtractDir);

      // Log the full extracted archive contents for diagnostics — proves
      // whether a missing dylib was actually present in the upstream
      // tarball or filtered out by our copy step.
      const archiveEntries = listArchiveEntriesRecursive(runtimeExtractDir);
      console.log(
        `[install-manager] (repair) runtime archive ${runtimeAssetName} extracted ` +
          `(${archiveEntries.length} entries):\n  ` +
          archiveEntries.join("\n  "),
      );

      const extractedBin = findFileRecursive(runtimeExtractDir, RUNTIME_BINARY_NAME);
      if (!extractedBin) {
        throw new Error(
          `llama-server binary not found inside the downloaded archive. ` +
            `This may indicate a release asset naming change — please file a bug.`,
        );
      }

      // Wipe existing runtime dir contents (files, symlinks, AND
      // subdirs) before installing fresh files so stale entries from a
      // partial / older / broken install can't shadow the new ones.
      // Preserves the runtime dir itself; never touches sibling dirs
      // like `models/` so installed models survive Repair Runtime.
      clearRuntimeDir(runtimeDir);

      const extractedBinDir = dirname(extractedBin);
      copyRuntimeFiles(extractedBinDir, runtimeDir);

      if (process.platform !== "win32") {
        chmodSync(runtimeBinPath, 0o755);
      }

      if (process.platform === "darwin") {
        try {
          await execFileAsync("xattr", ["-dr", "com.apple.quarantine", runtimeDir]);
        } catch {
          console.warn(
            "[installManager] could not remove quarantine attribute from runtime dir",
          );
        }
      }

      // Hard validation BEFORE we declare repair successful.  Same
      // dependency check as the full install — see the long comment in
      // the install path for rationale.  If validation fails the repair
      // is aborted with a precise missing-library list and the runtime
      // is left in a marked-incomplete state so the next start surfaces
      // the same missing-dependency banner instead of silently moving on.
      if (process.platform === "darwin") {
        const depCheck = await validateMacRuntimeDependencies(runtimeDir);
        if (!depCheck.ok) {
          const dirContents = listRuntimeDirContents(runtimeDir);
          throw new Error(
            `Runtime repair incomplete — missing required dynamic libraries on macOS: ` +
              `${depCheck.missing.join(", ")}. ` +
              `Asset "${runtimeAssetName}" was extracted but copy step did not preserve all dylibs. ` +
              `Runtime dir contents: ${dirContents.join(", ")}.`,
          );
        }
        console.log(
          `[install-manager] (repair) macOS runtime dependency check OK ` +
            `(${depCheck.rpathDeps.length} @rpath deps resolved)`,
        );
      }

      // Persist install metadata for the diagnostics panel.
      writeRuntimeMeta(runtimeDir, {
        assetName: runtimeAssetName,
        tag: runtimeReleaseTag,
        installedAt: Date.now(),
        platformTag: getRuntimePlatformTag(),
      });

      try {
        if (existsSync(runtimeArchiveTmp)) unlinkSync(runtimeArchiveTmp);
        if (existsSync(runtimeExtractDir)) {
          rmSync(runtimeExtractDir, { recursive: true, force: true });
        }
      } catch {
        /* best-effort cleanup */
      }

      if (!isRuntimeInstallComplete(runtimeDir)) {
        const missing = findMissingMacRuntimeDylibs(runtimeDir);
        const missingHint = missing.length
          ? ` Missing on disk: ${missing.join(", ")}.`
          : "";
        throw new Error(
          `Runtime reinstall verification failed — the installation may be incomplete.${missingHint} Please retry.`,
        );
      }

      report("verifying-runtime", "Runtime reinstalled successfully", 100);
    } finally {
      _installing = false;
    }
  },

  /**
   * Remove all files associated with `modelId` and unregister it from the DB.
   * Safe to call even if some files are missing.
   */
  async uninstall(modelId: string): Promise<void> {
    const modelsDir = storageService.getSubdir("models");
    const manifestsDir = storageService.getSubdir("manifests");
    const downloadsDir = storageService.getSubdir("downloads");

    const filesToRemove = [
      join(modelsDir, `${modelId}.gguf`),
      join(manifestsDir, `${modelId}.json`),
      join(downloadsDir, `${modelId}.gguf.tmp`),
    ];

    for (const filePath of filesToRemove) {
      try {
        if (existsSync(filePath)) unlinkSync(filePath);
      } catch (err) {
        console.error(`[installManager] failed to remove ${filePath}:`, err);
      }
    }

    modelRegistry.unregister(modelId);
  },

  /**
   * Fully remove the entire offline installation — runtime binary, all model
   * files, downloads/tmp/cache, manifests, and all offline DB state.
   *
   * Online chats, API keys, and unrelated app settings are NOT touched.
   *
   * The caller is responsible for stopping the runtime process before calling
   * this method so that the binary is not locked on Windows.
   */
  async removeAll(): Promise<void> {
    // 1. Uninstall every registered model (removes .gguf + manifest JSON from disk
    //    and unregisters from DB).
    const installed = modelRegistry.listInstalled();
    for (const record of installed) {
      await installManager.uninstall(record.id);
    }

    // 2. Remove entire runtime, downloads, and tmp subdirectories.
    for (const subdir of ["runtime", "downloads", "tmp", "manifests"] as const) {
      const dir = storageService.getSubdir(subdir);
      try {
        if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
      } catch (err) {
        console.error(`[installManager] failed to remove offline subdir ${subdir}:`, err);
      }
    }

    // 3. Clear all offline-related DB records without touching online data.
    clearOfflineData();
  },
};
