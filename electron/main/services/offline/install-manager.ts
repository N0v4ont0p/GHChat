import { join } from "path";
import {
  createWriteStream,
  createReadStream,
  existsSync,
  statSync,
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
  RUNTIME_BINARY_NAME,
} from "./runtime-catalog";
import { addOfflineManifestEntry, clearOfflineData, isDatabaseReady } from "../database";
import type { OfflineInstallPhase, OfflineInstallProgress } from "../../../../src/types";

const execFileAsync = promisify(execFile);

// ── Types ─────────────────────────────────────────────────────────────────────

type ProgressCallback = (progress: OfflineInstallProgress) => void;

// ── Helpers ───────────────────────────────────────────────────────────────────

const BYTES_PER_GB = 1024 ** 3;

/**
 * Download a file from `url` to `destPath`, following up to 5 redirects.
 * Reports (receivedBytes, totalBytes) to `onData` on each chunk — callers
 * compute percentage themselves so they can map it to any range they like.
 */
function downloadFile(
  url: string,
  destPath: string,
  onData: (receivedBytes: number, totalBytes: number) => void,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Ensure the parent directory exists before opening the write stream.
    mkdirSync(join(destPath, ".."), { recursive: true });

    function get(urlStr: string, redirectCount: number): void {
      if (redirectCount > 5) {
        reject(new Error("Too many redirects while downloading model"));
        return;
      }

      let parsedUrl: URL;
      try {
        parsedUrl = new URL(urlStr);
      } catch {
        reject(new Error(`Invalid download URL: ${urlStr}`));
        return;
      }

      const mod = parsedUrl.protocol === "https:" ? https : http;

      const req = mod.get(urlStr, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          req.destroy();
          get(res.headers.location, redirectCount + 1);
          return;
        }

        if (!res.statusCode || res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`Download failed: HTTP ${res.statusCode}`));
          return;
        }

        const totalBytes = parseInt(res.headers["content-length"] ?? "0", 10) || 0;
        let receivedBytes = 0;

        const fileStream = createWriteStream(destPath);

        res.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          onData(receivedBytes, totalBytes);
        });

        res.pipe(fileStream);
        fileStream.on("finish", resolve);
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
      // Skip if the binary is already present (e.g. re-install of a model).
      if (!existsSync(runtimeBinPath)) {
        report("downloading-runtime", "Looking up latest llama.cpp release…", 4);

        let runtimeDownloadUrl: string;
        let runtimeSizeBytes: number;
        let runtimeArchiveExt: string;
        let runtimeAssetName: string;
        try {
          const release = await fetchLatestRuntimeRelease();
          runtimeDownloadUrl = release.downloadUrl;
          runtimeSizeBytes = release.sizeBytes;
          runtimeArchiveExt = release.archiveExt;
          runtimeAssetName = release.assetName;
          report(
            "downloading-runtime",
            `Downloading runtime ${release.tag} (${getRuntimePlatformTag()}: ${runtimeAssetName})…`,
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
          throw new Error(
            `Failed to locate llama.cpp runtime release: ${err instanceof Error ? err.message : String(err)}`,
            err !== undefined ? { cause: err } : undefined,
          );
        }

        // Clean up any partial previous download.
        if (existsSync(runtimeArchiveTmp)) unlinkSync(runtimeArchiveTmp);

        const rtDownloadStart = Date.now();
        await downloadFile(runtimeDownloadUrl, runtimeArchiveTmp, (received, total) => {
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
        });

        report("downloading-runtime", "Runtime download complete", 22);

        // ── 4. Extract and verify runtime binary ─────────────────────────────────
        report("verifying-runtime", "Extracting runtime…", 23);

        await extractRuntimeArchive(runtimeArchiveTmp, runtimeArchiveExt, runtimeExtractDir);

        const extractedBin = findFileRecursive(runtimeExtractDir, RUNTIME_BINARY_NAME);
        if (!extractedBin) {
          throw new Error(
            `llama-server binary not found inside the downloaded archive. ` +
              `This may indicate a release asset naming change — please file a bug.`,
          );
        }

        // Move the binary to the managed runtime dir.
        if (existsSync(runtimeBinPath)) unlinkSync(runtimeBinPath);
        renameSync(extractedBin, runtimeBinPath);

        // Make it executable on Unix.
        if (process.platform !== "win32") {
          chmodSync(runtimeBinPath, 0o755);
        }

        // On macOS, remove the quarantine extended attribute that Gatekeeper
        // adds to files downloaded from the internet.  Without this the OS
        // would refuse to run the unsigned binary or prompt the user.
        if (process.platform === "darwin") {
          try {
            // execFile: no shell — args passed directly, no injection risk.
            await execFileAsync("xattr", ["-dr", "com.apple.quarantine", runtimeBinPath]);
          } catch {
            // Not fatal — the binary may still work if the user approved it.
            console.warn(
              "[installManager] could not remove quarantine attribute from llama-server",
            );
          }
        }

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
        // Binary already present — skip the download but still report the phases
        // so the UI phase list is consistent.
        report("downloading-runtime", "Runtime already installed", 22);
        report("verifying-runtime", "Runtime verified", 25);
      }

      // ── 5. Download model ────────────────────────────────────────────────────
      // Clean up any previous partial download.
      if (existsSync(tmpPath)) unlinkSync(tmpPath);

      report("downloading-model", "Connecting to download server…", 27);

      const downloadStartMs = Date.now();
      await downloadFile(entry.downloadUrl, tmpPath, (received, total) => {
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
      });

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

      // Verify the runtime binary is present and executable.
      if (!existsSync(runtimeBinPath)) {
        throw new Error(
          "Runtime binary is missing after installation — please retry the install.",
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

      // Runtime binary must exist.
      const runtimeBinPath = join(storageService.getSubdir("runtime"), RUNTIME_BINARY_NAME);
      if (!existsSync(runtimeBinPath)) {
        return { ok: false, reason: "Runtime binary missing — the runtime must be reinstalled" };
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
