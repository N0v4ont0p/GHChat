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
   *
   * Follows the standard HuggingFace `/resolve/{rev}/...` pattern. We
   * intentionally point at **ungated** mirrors (currently the `unsloth/`
   * organization's GGUF re-uploads of the latest publicly-available Gemma
   * weights) so the installer works without requiring users to create a
   * HuggingFace account, accept gated-repo terms, or provide an access
   * token.
   *
   * Why not `google/gemma-*-it-GGUF` directly?
   *   - Those repositories are **gated** on HuggingFace and return HTTP 401
   *     to unauthenticated `/resolve/...` requests, which manifested as the
   *     "Download failed: HTTP 401" stall the installer used to hit at the
   *     start of the model-download phase.
   *
   * Operators who do want to use a different (e.g. gated) source can:
   *   - Set the `GHCHAT_OFFLINE_MODEL_BASE_URL` env var to a host/path
   *     prefix that exposes files under the same final filename, **and/or**
   *   - Set `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` / `GHCHAT_HF_TOKEN` so
   *     the downloader sends `Authorization: Bearer <token>` on the
   *     initial request (the header is automatically dropped on cross-host
   *     redirects to the HuggingFace CDN to avoid leaking it).
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
//
// "Gemma 4" is the GHchat product label for the offline experience.  The
// underlying GGUF weights below are pulled from the `unsloth/` HuggingFace
// organization, which mirrors the latest publicly-available Gemma family
// (currently Gemma 3 instruction-tuned variants) as **ungated** repositories.
//
// We deliberately do **not** point at `google/gemma-*-it-GGUF` because those
// repositories are gated and respond with HTTP 401 to unauthenticated
// `/resolve/...` requests — which used to manifest as the install stalling at
// 27 % with "Download failed: HTTP 401".  See the `downloadUrl` doc comment on
// `OfflineModelEntry` above for how to override the source if you do want to
// use a gated mirror.

/**
 * Optional override for the host/path prefix used to assemble the model
 * download URL.  When set, the trailing GGUF filename is appended to this
 * prefix.  Useful for air-gapped mirrors or alternative hosting.
 *
 * Example: `GHCHAT_OFFLINE_MODEL_BASE_URL=https://mirror.example.com/gemma`
 *  → downloadUrl becomes `https://mirror.example.com/gemma/<filename>.gguf`
 */
const MODEL_BASE_URL_OVERRIDE =
  process.env.GHCHAT_OFFLINE_MODEL_BASE_URL?.trim() || null;

/**
 * Build the resolve URL for a GGUF file in an ungated unsloth HF repo,
 * honouring the optional `GHCHAT_OFFLINE_MODEL_BASE_URL` mirror override.
 */
function buildModelUrl(repo: string, filename: string): string {
  if (MODEL_BASE_URL_OVERRIDE) {
    const base = MODEL_BASE_URL_OVERRIDE.replace(/\/+$/, "");
    return `${base}/${filename}`;
  }
  return `https://huggingface.co/${repo}/resolve/main/${filename}`;
}

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
    downloadUrl: buildModelUrl(
      "unsloth/gemma-3-4b-it-GGUF",
      "gemma-3-4b-it-Q4_K_M.gguf",
    ),
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
    downloadUrl: buildModelUrl(
      "unsloth/gemma-3-4b-it-GGUF",
      "gemma-3-4b-it-Q5_K_M.gguf",
    ),
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
    downloadUrl: buildModelUrl(
      "unsloth/gemma-3-12b-it-GGUF",
      "gemma-3-12b-it-Q4_K_M.gguf",
    ),
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
    downloadUrl: buildModelUrl(
      "unsloth/gemma-3-12b-it-GGUF",
      "gemma-3-12b-it-Q5_K_M.gguf",
    ),
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
    downloadUrl: buildModelUrl(
      "unsloth/gemma-3-27b-it-GGUF",
      "gemma-3-27b-it-Q4_K_M.gguf",
    ),
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
