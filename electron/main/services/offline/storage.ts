import { app } from "electron";
import { join } from "path";
import { mkdirSync, statfsSync, readdirSync, lstatSync } from "fs";

/** Sub-directories managed inside the GHchat offline root. */
export const OFFLINE_SUBDIRS = [
  "runtime",
  "models",
  "downloads",
  "tmp",
  "manifests",
] as const;

export type OfflineSubdir = (typeof OFFLINE_SUBDIRS)[number];

/**
 * Resolve the platform-specific persistent offline root directory.
 *
 * macOS : ~/Library/Application Support/GHChat/offline
 * Windows: %LOCALAPPDATA%\GHChat\offline  (falls back through
 *           app.getPath("appData") which maps to %APPDATA% when
 *           LOCALAPPDATA is not set in the process environment)
 * Linux  : ~/.config/GHChat/offline  (via app.getPath("appData"))
 *
 * All offline-owned files must stay under this root so that GHchat can
 * enumerate, verify, and cleanly remove everything it manages.
 */
function resolveOfflineRoot(): string {
  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA;
    if (localAppData) return join(localAppData, "GHChat", "offline");
    // Fallback: LOCALAPPDATA is missing (unusual) — use appData (%APPDATA%).
  }
  return join(app.getPath("appData"), "GHChat", "offline");
}

/**
 * Storage service — owns the GHchat offline root directory tree.
 *
 * All paths returned by this service are absolute and guaranteed to be
 * under a single GHchat-managed root, making the offline installation
 * self-contained and cleanly removable.
 */
export const storageService = {
  /** Return the absolute path to the GHchat offline root directory. */
  getOfflineRoot(): string {
    return resolveOfflineRoot();
  },

  /** Return the absolute path for a named sub-directory. */
  getSubdir(name: OfflineSubdir): string {
    return join(resolveOfflineRoot(), name);
  },

  /** Return the absolute path to the models sub-directory. */
  getModelStorePath(): string {
    return join(resolveOfflineRoot(), "models");
  },

  /**
   * Create the offline root and all required sub-directories.
   * Safe to call multiple times — existing directories are left untouched.
   */
  ensureDirectories(): void {
    const root = resolveOfflineRoot();
    mkdirSync(root, { recursive: true });
    for (const sub of OFFLINE_SUBDIRS) {
      mkdirSync(join(root, sub), { recursive: true });
    }
  },

  /**
   * Return available disk space in gigabytes at the offline root.
   * Returns 0 when the query fails (e.g. unsupported OS or path error).
   *
   * Declared async for API consistency: callers can await it uniformly,
   * and future implementations may use async fs APIs or IPC bridges.
   */
  async availableSpaceGb(): Promise<number> {
    const root = resolveOfflineRoot();
    try {
      // Ensure the root exists before querying; statfsSync requires a real path.
      mkdirSync(root, { recursive: true });
      const stats = statfsSync(root);
      return (stats.bavail * stats.bsize) / 1024 ** 3;
    } catch {
      return 0;
    }
  },

  /**
   * Recursively sum the sizes of all files under the offline root.
   * Returns 0 when the root does not exist or any stat call fails.
   */
  computeUsedBytes(): number {
    function walk(dir: string): number {
      let total = 0;
      try {
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          const fullPath = join(dir, entry.name);
          if (entry.isDirectory()) {
            total += walk(fullPath);
          } else if (entry.isFile() || entry.isSymbolicLink()) {
            try {
              // Use lstatSync to measure the symlink itself rather than following
              // it — avoids double-counting when a symlink points to a file that
              // is already accounted for elsewhere in the tree.
              total += lstatSync(fullPath).size;
            } catch {
              // File may have been removed between readdir and stat — skip it.
            }
          }
        }
      } catch {
        // Directory may not exist or may be unreadable — return 0.
      }
      return total;
    }
    return walk(resolveOfflineRoot());
  },
};

