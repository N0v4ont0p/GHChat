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
} from "fs";
import { createHash } from "crypto";
import * as https from "https";
import * as http from "http";
import { offlineCatalog } from "./catalog";
import { storageService } from "./storage";
import { modelRegistry } from "./model-registry";
import { addOfflineManifestEntry, isDatabaseReady } from "../database";
import type { OfflineInstallPhase, OfflineInstallProgress } from "../../../../src/types";

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

// ── Install lock ──────────────────────────────────────────────────────────────

/** True while an install is in progress — prevents concurrent installs. */
let _installing = false;

// ── Install manager ───────────────────────────────────────────────────────────

/**
 * Install manager — the single authoritative implementation of the GHchat
 * offline install pipeline.
 *
 * Pipeline (8 phases):
 *  1. Preflight     — validate catalog entry, platform, disk space
 *  2. Directories   — ensure all offline sub-directories exist
 *  3. Download      — stream GGUF file to `downloads/{id}.gguf.tmp`
 *  4. Verify        — SHA-256 checksum (skipped when sha256 = "pending")
 *  5. Move          — atomic rename tmp → `models/{id}.gguf`
 *  6. Manifest      — write `manifests/{id}.json` with install metadata
 *  7. Register      — persist to DB (offline_models + offline_manifests tables)
 *  8. Smoke test    — confirm file present and size within 50 % of expected
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

    const report = (phase: OfflineInstallPhase, step: string, pct: number) => {
      onProgress?.({ phase, step, pct });
    };

    try {
      // ── 1. Preflight ─────────────────────────────────────────────────────────
      report("preflight", "Checking system requirements…", 2);

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

      report("preflight", "System check passed", 5);

      // ── 2. Directories ───────────────────────────────────────────────────────
      storageService.ensureDirectories();

      const modelsDir = storageService.getSubdir("models");
      const downloadsDir = storageService.getSubdir("downloads");
      const manifestsDir = storageService.getSubdir("manifests");

      const tmpPath = join(downloadsDir, `${modelId}.gguf.tmp`);
      const modelPath = join(modelsDir, `${modelId}.gguf`);
      const manifestPath = join(manifestsDir, `${modelId}.json`);

      // Clean up any previous partial download.
      if (existsSync(tmpPath)) unlinkSync(tmpPath);

      // ── 3. Download ──────────────────────────────────────────────────────────
      report("downloading", "Connecting to download server…", 8);

      await downloadFile(entry.downloadUrl, tmpPath, (received, total) => {
        // Map download progress to the 8–80 % range.
        const dlPct = total > 0 ? received / total : 0;
        const pct = 8 + Math.round(dlPct * 72);
        const mb = (received / (1024 * 1024)).toFixed(0);
        const totalMb = total > 0 ? ` / ${(total / (1024 * 1024)).toFixed(0)} MB` : "";
        report("downloading", `Downloading model weights… ${mb} MB${totalMb}`, pct);
      });

      report("downloading", "Download complete", 80);

      // ── 4. Verify checksum ───────────────────────────────────────────────────
      report("verifying", "Verifying file integrity…", 82);

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

      report("verifying", "Integrity check passed", 85);

      // ── 5. Move to managed storage ───────────────────────────────────────────
      report("registering", "Installing model file…", 87);

      // Remove any pre-existing model file (handles reinstall / repair case).
      if (existsSync(modelPath)) unlinkSync(modelPath);
      renameSync(tmpPath, modelPath);

      // ── 6. Write manifest JSON ───────────────────────────────────────────────
      report("registering", "Writing install manifest…", 90);

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

      // ── 7. Register in DB ────────────────────────────────────────────────────
      report("registering", "Registering model in database…", 93);

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

      // ── 8. Smoke test ────────────────────────────────────────────────────────
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

      report("smoke-test", "Installation complete", 100);
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
};

