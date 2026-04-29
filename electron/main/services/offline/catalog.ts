/** Top-level model family used for the offline install path. */
export type OfflineModelFamily = "gemma-4" | "gemma-3";

/** Describes a single offline-installable variant in the curated catalog. */
export interface OfflineModelEntry {
  /** Unique catalog identifier, e.g. "gemma4-e4b-q4km" or "gemma3-4b-q4km". */
  id: string;
  /** Top-level model family. Drives default-vs-fallback selection. */
  family: OfflineModelFamily;
  /**
   * True when this entry is **only** valid as a user-chosen fallback after
   * the preferred family (Gemma 4) has repeatedly failed to install.  The
   * default recommendation flow MUST NOT pick a fallback entry on its own.
   */
  isFallback: boolean;
  /** Human-readable model family label, e.g. "Gemma 4 E4B". */
  name: string;
  /** Variant label shown to users, e.g. "E4B · Q4_K_M". */
  variantLabel: string;
  /** Model version string. */
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
   * Follows the standard HuggingFace `/resolve/{rev}/...` pattern.  Gemma 4
   * artifacts are pulled from the **public, ungated** `unsloth/gemma-4-*`
   * repositories that mirror Google's Gemma 4 release.  Gemma 3 fallback
   * artifacts come from the `unsloth/gemma-3-*` mirrors.
   *
   * Why not `google/gemma-*-it-GGUF` directly?
   *   - Those repositories are **gated** on HuggingFace and return HTTP 401
   *     to unauthenticated `/resolve/...` requests, which would cause the
   *     installer to stall at the start of the model-download phase.
   *
   * Operators who do want to use a different (e.g. gated, mirrored) source
   * can:
   *   - Set `GHCHAT_OFFLINE_MODEL_BASE_URL` to a host/path prefix that
   *     exposes files under the same final filename, **and/or**
   *   - Set `HF_TOKEN` / `HUGGING_FACE_HUB_TOKEN` / `GHCHAT_HF_TOKEN` so
   *     the downloader sends `Authorization: Bearer <token>` on the
   *     initial request (the header is automatically dropped on cross-host
   *     redirects to the HuggingFace CDN to avoid leaking it).
   */
  downloadUrl: string;
  /**
   * Expected SHA-256 hex digest of the downloaded file.
   * NOTE: placeholder — must be updated once official artifacts are
   * checksum-pinned.  Until then, integrity verification is skipped at
   * install time (see install-manager.ts).
   */
  sha256: string;
}

// ── Curated catalog ───────────────────────────────────────────────────────────
//
// Two families:
//
//   * Gemma 4 (preferred default — `family: "gemma-4"`, `isFallback: false`)
//       Pulled from the public `unsloth/gemma-4-*-it-GGUF` mirrors of
//       Google's Gemma 4 release.  This is what the recommendation flow
//       picks for fresh users.
//
//   * Gemma 3 (explicit fallback only — `family: "gemma-3"`,
//     `isFallback: true`)
//       Pulled from the public `unsloth/gemma-3-*-it-GGUF` mirrors.
//       NEVER selected by the default recommendation logic.  The IPC layer
//       only surfaces these entries to the UI after Gemma 4 has failed to
//       install repeatedly (see GEMMA4_FAILURE_THRESHOLD in
//       install-manager.ts), and the user must click one explicitly to
//       opt in.
//
// We deliberately do **not** point at `google/gemma-*-it-GGUF` because
// those repositories are gated and respond with HTTP 401 to unauthenticated
// `/resolve/...` requests.  See the `downloadUrl` doc comment on
// `OfflineModelEntry` above for how to override the source if you do want
// to use a gated mirror.

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

// ── Gemma 4 (preferred default) ───────────────────────────────────────────────
// Sizes follow the published Gemma 4 lineup: E2B (~2B effective), E4B
// (~4B effective), 26B-A4B (MoE, 4B active params), 31B (dense).
const GEMMA4: readonly OfflineModelEntry[] = [
  {
    id: "gemma4-e2b-q4km",
    family: "gemma-4",
    isFallback: false,
    name: "Gemma 4 E2B",
    variantLabel: "E2B · Q4_K_M",
    version: "4.0",
    sizeGb: 2.7,
    quantization: "Q4_K_M",
    ramRequiredGb: 4,
    diskRequiredGb: 4,
    tier: "fast",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl: buildModelUrl(
      "unsloth/gemma-4-E2B-it-GGUF",
      "gemma-4-E2B-it-Q4_K_M.gguf",
    ),
    sha256: "pending",
  },
  {
    id: "gemma4-e4b-q4km",
    family: "gemma-4",
    isFallback: false,
    name: "Gemma 4 E4B",
    variantLabel: "E4B · Q4_K_M",
    version: "4.0",
    sizeGb: 5.0,
    quantization: "Q4_K_M",
    ramRequiredGb: 8,
    diskRequiredGb: 7,
    tier: "balanced",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl: buildModelUrl(
      "unsloth/gemma-4-E4B-it-GGUF",
      "gemma-4-E4B-it-Q4_K_M.gguf",
    ),
    sha256: "pending",
  },
  {
    id: "gemma4-e4b-q5km",
    family: "gemma-4",
    isFallback: false,
    name: "Gemma 4 E4B",
    variantLabel: "E4B · Q5_K_M",
    version: "4.0",
    sizeGb: 6.0,
    quantization: "Q5_K_M",
    ramRequiredGb: 10,
    diskRequiredGb: 8,
    tier: "quality",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl: buildModelUrl(
      "unsloth/gemma-4-E4B-it-GGUF",
      "gemma-4-E4B-it-Q5_K_M.gguf",
    ),
    sha256: "pending",
  },
  {
    id: "gemma4-26b-a4b-q4km",
    family: "gemma-4",
    isFallback: false,
    // 26B-A4B is a Mixture-of-Experts model: 26B total params with only
    // ~4B active per token, so it punches well above its weight on
    // RAM-constrained machines while still fitting on a workstation.
    name: "Gemma 4 26B (A4B MoE)",
    variantLabel: "26B-A4B · Q4_K_M",
    version: "4.0",
    sizeGb: 17.0,
    quantization: "Q4_K_M",
    ramRequiredGb: 24,
    diskRequiredGb: 20,
    tier: "quality",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl: buildModelUrl(
      "unsloth/gemma-4-26B-A4B-it-GGUF",
      "gemma-4-26B-A4B-it-Q4_K_M.gguf",
    ),
    sha256: "pending",
  },
  {
    id: "gemma4-31b-q4km",
    family: "gemma-4",
    isFallback: false,
    name: "Gemma 4 31B",
    variantLabel: "31B · Q4_K_M",
    version: "4.0",
    sizeGb: 19.5,
    quantization: "Q4_K_M",
    ramRequiredGb: 32,
    diskRequiredGb: 24,
    tier: "quality",
    platforms: ["darwin", "linux", "win32"],
    downloadUrl: buildModelUrl(
      "unsloth/gemma-4-31B-it-GGUF",
      "gemma-4-31B-it-Q4_K_M.gguf",
    ),
    sha256: "pending",
  },
] as const;

// ── Gemma 3 (explicit fallback only) ──────────────────────────────────────────
// These entries are NEVER picked by the default recommendation flow.  They
// are surfaced to the user as opt-in fallbacks when Gemma 4 install attempts
// have failed enough times that the IPC layer transitions to the
// `fallback-offered` state.
const GEMMA3_FALLBACK: readonly OfflineModelEntry[] = [
  {
    id: "gemma3-4b-q4km",
    family: "gemma-3",
    isFallback: true,
    name: "Gemma 3 4B",
    variantLabel: "4B · Q4_K_M",
    version: "3.0",
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
    id: "gemma3-12b-q4km",
    family: "gemma-3",
    isFallback: true,
    name: "Gemma 3 12B",
    variantLabel: "12B · Q4_K_M",
    version: "3.0",
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
    id: "gemma3-27b-q4km",
    family: "gemma-3",
    isFallback: true,
    name: "Gemma 3 27B",
    variantLabel: "27B · Q4_K_M",
    version: "3.0",
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

const CATALOG: readonly OfflineModelEntry[] = [...GEMMA4, ...GEMMA3_FALLBACK];

/**
 * Offline model catalog — the single authoritative source for what GHchat
 * can install offline.
 *
 * Use `listPreferred()` for the default Gemma-4 recommendation pipeline.
 * Use `listFallbacks()` only when surfacing explicit fallback options to
 * the user after repeated Gemma-4 install failures.
 */
export const offlineCatalog = {
  /** Return all catalog entries (preferred + fallback). */
  listAvailable(): OfflineModelEntry[] {
    return [...CATALOG];
  },

  /**
   * Return only the preferred-family entries (Gemma 4).  This is what the
   * default recommendation pipeline considers — Gemma 3 entries are
   * deliberately excluded so the app cannot silently substitute them.
   */
  listPreferred(): OfflineModelEntry[] {
    return CATALOG.filter((e) => !e.isFallback);
  },

  /**
   * Return only the explicit-fallback entries (Gemma 3).  These are
   * surfaced to the user only after Gemma 4 has failed to install enough
   * times that the install pipeline transitions to the fallback-offered
   * state.  NEVER auto-selected.
   */
  listFallbacks(): OfflineModelEntry[] {
    return CATALOG.filter((e) => e.isFallback);
  },

  /** Look up a catalog entry by its unique ID. */
  getById(id: string): OfflineModelEntry | undefined {
    return CATALOG.find((e) => e.id === id);
  },
};
