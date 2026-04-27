import type { HardwareProfile } from "./hardware-profile";
import { offlineCatalog, type OfflineModelEntry } from "./catalog";
import type { OfflineRecommendation, OfflineProfileSummary } from "../../../../src/types";

export interface ModelRecommendation {
  model: OfflineModelEntry;
  /** Human-readable explanation of why this model fits the hardware. */
  reason: string;
}

// ── Disk headroom factor ──────────────────────────────────────────────────────
// Require 10% more free disk than the model's stated minimum so the OS and
// other processes keep breathing room.
const DISK_HEADROOM = 1.1;

// ── Tier preference order ─────────────────────────────────────────────────────
// When multiple entries fit the hardware profile, we prefer the largest/highest-
// quality model that still fits.  The catalog is ordered smallest→largest, so
// we simply iterate in reverse to find the biggest fit.

/**
 * Build a human-readable explanation of a recommendation decision.
 */
function buildReason(
  entry: OfflineModelEntry,
  profile: HardwareProfile,
  isFallback: boolean,
): string {
  const ramGb = Math.round(profile.totalRamGb);
  const diskGb = Math.round(profile.freeDiskGb);

  if (isFallback) {
    return (
      `Your device has ${ramGb} GB of RAM and ${diskGb} GB of free disk space. ` +
      `The ${entry.variantLabel} variant is the smallest available and will ` +
      `run on most hardware, though performance may be limited on this device.`
    );
  }

  if (profile.isAppleSilicon) {
    return (
      `Your Apple Silicon Mac has ${ramGb} GB of unified memory. ` +
      `The ${entry.variantLabel} variant takes full advantage of Metal GPU acceleration, ` +
      `delivering fast, high-quality responses entirely on-device.`
    );
  }

  if (entry.id.startsWith("gemma4-27b")) {
    return (
      `Your device has ${ramGb} GB of RAM — enough to run the largest available ` +
      `Gemma 4 variant. ${entry.variantLabel} gives you the best possible ` +
      `response quality while staying fully offline.`
    );
  }

  if (entry.id.startsWith("gemma4-12b")) {
    return (
      `With ${ramGb} GB of RAM and ${diskGb} GB of free disk, your device is ` +
      `well-suited for the ${entry.variantLabel} variant. It offers a strong ` +
      `balance of quality and speed for everyday offline chat.`
    );
  }

  if (entry.quantization === "Q5_K_M") {
    return (
      `Your device has ${ramGb} GB of RAM. The ${entry.variantLabel} variant ` +
      `gives you slightly higher response quality than the standard compressed ` +
      `version, while still loading quickly on most machines.`
    );
  }

  return (
    `Your device has ${ramGb} GB of RAM and ${diskGb} GB of free disk space. ` +
    `The ${entry.variantLabel} variant offers the best balance of quality and ` +
    `speed for your hardware.`
  );
}

/**
 * Recommendation service — maps a hardware profile to the single best Gemma 4
 * catalog entry using deterministic, explainable logic.
 *
 * Algorithm:
 * 1. Filter catalog to entries whose RAM and disk requirements fit the device.
 * 2. Apply Apple Silicon upgrade: prefer quality tiers when Metal is available.
 * 3. Among remaining candidates, pick the largest/highest-quality fit.
 * 4. If nothing fits, fall back to the smallest entry unconditionally (with a
 *    marginal-fit explanation so the user can make an informed decision).
 */
export const recommendationService = {
  /**
   * Return the single best Gemma 4 recommendation for the given profile, plus
   * the full renderer-ready `OfflineRecommendation` payload.
   */
  recommend(profile: HardwareProfile): ModelRecommendation & {
    offlineRecommendation: OfflineRecommendation;
  } {
    const all = offlineCatalog.listAvailable();

    // Filter to entries that support this platform.
    const platformCompatible = all.filter((e) =>
      (e.platforms as string[]).includes(profile.platform),
    );

    // Filter by RAM and disk.
    const fits = platformCompatible.filter(
      (e) =>
        profile.totalRamGb >= e.ramRequiredGb &&
        profile.freeDiskGb >= e.diskRequiredGb * DISK_HEADROOM,
    );

    let chosen: OfflineModelEntry;
    let isFallback = false;

    if (fits.length === 0) {
      // Nothing fits — pick the smallest unconditionally as a marginal option.
      chosen = platformCompatible[0] ?? all[0];
      isFallback = true;
    } else if (profile.isAppleSilicon) {
      // Apple Silicon: pick the largest fitting entry (Metal makes big models fast).
      chosen = fits[fits.length - 1];
    } else {
      // Non-Apple: pick the largest fitting entry but cap at 12B unless the
      // machine has a lot of RAM (≥ 32 GB), in which case allow 27B.
      const capped =
        profile.totalRamGb < 32
          ? fits.filter((e) => !e.id.startsWith("gemma4-27b"))
          : fits;
      const candidates = capped.length > 0 ? capped : fits;
      chosen = candidates[candidates.length - 1];
    }

    const reason = buildReason(chosen, profile, isFallback);

    const profileSummary: OfflineProfileSummary = {
      totalRamGb: Math.round(profile.totalRamGb * 10) / 10,
      freeDiskGb: Math.round(profile.freeDiskGb * 10) / 10,
      platform: String(profile.platform),
      arch: profile.arch,
      isAppleSilicon: profile.isAppleSilicon,
      cpuCores: profile.cpuCores,
    };

    const offlineRecommendation: OfflineRecommendation = {
      modelId: chosen.id,
      label: chosen.name,
      variantLabel: chosen.variantLabel,
      sizeGb: chosen.sizeGb,
      tier: chosen.tier,
      reason,
      profile: profileSummary,
    };

    return { model: chosen, reason, offlineRecommendation };
  },

  /** Return ranked model recommendations for the given hardware profile. */
  async recommend_ranked(profile: HardwareProfile): Promise<ModelRecommendation[]> {
    const { model, reason } = this.recommend(profile);
    return [{ model, reason }];
  },
};

