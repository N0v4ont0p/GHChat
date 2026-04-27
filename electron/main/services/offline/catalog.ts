/** Describes a single offline-installable Gemma 4 variant in the curated catalog. */
export interface OfflineModelEntry {
  /** Unique catalog identifier, e.g. "gemma4-4b-q4km". */
  id: string;
  /** Human-readable model family label, e.g. "Gemma 4 4B". */
  name: string;
  /** Variant label shown to users, e.g. "4B · Q4_K_M". */
  variantLabel: string;
  /** Gemma model version string. */
  version: string;
  /** Approximate download (and disk) size in gigabytes. */
  sizeGb: number;
  /** GGUF quantization scheme. */
  quantization: string;
  /** Minimum total system RAM in gigabytes required to run this variant. */
  ramRequiredGb: number;
  /** Minimum free disk space in gigabytes required to download + install. */
  diskRequiredGb: number;
  /** Quality / speed tradeoff tier. */
  tier: "balanced" | "quality" | "fast";
  /** Supported OS platforms (Node.js platform strings). */
  platforms: NodeJS.Platform[];
  /**
   * Primary download URL for the GGUF file.
   * Follows the standard HuggingFace resolve pattern.
   * NOTE: placeholder until Gemma 4 GGUF artifacts are published.
   */
  downloadUrl: string;
  /**
   * Expected SHA-256 hex digest of the downloaded file.
   * NOTE: placeholder — must be updated once official artifacts ship.
   * TODO: Update checksums when Gemma 4 GGUF artifacts are published on
   *       HuggingFace. Until then, integrity verification is skipped at
   *       install time (see install-manager.ts).
   */
  sha256: string;
}

// ── Curated Gemma 4 catalog ───────────────────────────────────────────────────
// Five variants covering the full range of supported hardware:
//   4B  Q4_K_M — balanced quality/speed for modest hardware (6 GB RAM minimum)
//   4B  Q5_K_M — slightly higher quality for machines with ≥ 8 GB RAM
//   12B Q4_K_M — strong quality for mid-range machines (12 GB RAM)
//   12B Q5_K_M — higher-quality 12B for well-equipped machines (16 GB RAM)
//   27B Q4_K_M — best quality for high-RAM machines / Apple Silicon (24 GB RAM)
//
// Recommendation logic in recommendation.ts selects the single best fit for the
// detected hardware profile.  The catalog itself is inert data — no selection
// decisions live here.

const CATALOG: readonly OfflineModelEntry[] = [
  {
    id: "gemma4-4b-q4km",
    name: "Gemma 4 4B",
    variantLabel: "4B · Q4_K_M",
    version: "4.0",
    sizeGb: 3.5,
    quantization: "Q4_K_M",
    ramRequiredGb: 6,
    diskRequiredGb: 5,
    tier: "balanced",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl:
      "https://huggingface.co/google/gemma-4-4b-it-GGUF/resolve/main/gemma-4-4b-it-Q4_K_M.gguf",
    sha256: "pending",
  },
  {
    id: "gemma4-4b-q5km",
    name: "Gemma 4 4B",
    variantLabel: "4B · Q5_K_M",
    version: "4.0",
    sizeGb: 4.1,
    quantization: "Q5_K_M",
    ramRequiredGb: 8,
    diskRequiredGb: 6,
    tier: "quality",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl:
      "https://huggingface.co/google/gemma-4-4b-it-GGUF/resolve/main/gemma-4-4b-it-Q5_K_M.gguf",
    sha256: "pending",
  },
  {
    id: "gemma4-12b-q4km",
    name: "Gemma 4 12B",
    variantLabel: "12B · Q4_K_M",
    version: "4.0",
    sizeGb: 7.8,
    quantization: "Q4_K_M",
    ramRequiredGb: 12,
    diskRequiredGb: 10,
    tier: "quality",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl:
      "https://huggingface.co/google/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q4_K_M.gguf",
    sha256: "pending",
  },
  {
    id: "gemma4-12b-q5km",
    name: "Gemma 4 12B",
    variantLabel: "12B · Q5_K_M",
    version: "4.0",
    sizeGb: 9.6,
    quantization: "Q5_K_M",
    ramRequiredGb: 16,
    diskRequiredGb: 12,
    tier: "quality",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl:
      "https://huggingface.co/google/gemma-4-12b-it-GGUF/resolve/main/gemma-4-12b-it-Q5_K_M.gguf",
    sha256: "pending",
  },
  {
    id: "gemma4-27b-q4km",
    name: "Gemma 4 27B",
    variantLabel: "27B · Q4_K_M",
    version: "4.0",
    sizeGb: 17.3,
    quantization: "Q4_K_M",
    ramRequiredGb: 24,
    diskRequiredGb: 20,
    tier: "quality",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl:
      "https://huggingface.co/google/gemma-4-27b-it-GGUF/resolve/main/gemma-4-27b-it-Q4_K_M.gguf",
    sha256: "pending",
  },
] as const;

/**
 * Offline model catalog — curated list of supported Gemma 4 GGUF variants.
 * This is the single authoritative source for what GHchat can install offline.
 */
export const offlineCatalog = {
  /** Return all catalog entries. */
  listAvailable(): OfflineModelEntry[] {
    return [...CATALOG];
  },

  /** Look up a catalog entry by its unique ID. */
  getById(id: string): OfflineModelEntry | undefined {
    return CATALOG.find((e) => e.id === id);
  },
};
