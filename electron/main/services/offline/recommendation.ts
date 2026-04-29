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
// quality model that still fits.  Each family list is ordered smallest→largest,
// so we simply iterate in reverse to find the biggest fit.

/**
 * Build a human-readable explanation of a recommendation decision for a
 * Gemma 4 model entry.
 */
function buildGemma4Reason(
  entry: OfflineModelEntry,
  profile: HardwareProfile,
  isMarginalFit: boolean,
): string {
  const ramGb = Math.round(profile.totalRamGb);
  const diskGb = Math.round(profile.freeDiskGb);

  if (isMarginalFit) {
    return (
      `Your device has ${ramGb} GB of RAM and ${diskGb} GB of free disk space. ` +
      `${entry.variantLabel} is the lightest Gemma 4 variant and will run on ` +
      `most hardware, though performance may be limited on this device.`
    );
  }

  if (profile.isAppleSilicon) {
    return (
      `Your Apple Silicon Mac has ${ramGb} GB of unified memory. ` +
      `Gemma 4 ${entry.variantLabel} takes full advantage of Metal GPU ` +
      `acceleration, delivering fast, high-quality responses entirely on-device.`
    );
  }

  if (entry.id.startsWith("gemma4-31b")) {
    return (
      `Your device has ${ramGb} GB of RAM — enough to run the largest dense ` +
      `Gemma 4 variant. ${entry.variantLabel} gives you the best possible ` +
      `response quality while staying fully offline.`
    );
  }

  if (entry.id.startsWith("gemma4-26b-a4b")) {
    return (
      `Your device has ${ramGb} GB of RAM, which is enough for the Gemma 4 ` +
      `26B-A4B Mixture-of-Experts variant. Only ~4B parameters are active ` +
      `per token, so quality stays high while latency stays low.`
    );
  }

  if (entry.id.startsWith("gemma4-e4b")) {
    return (
      `With ${ramGb} GB of RAM and ${diskGb} GB of free disk, your device is ` +
      `well-suited for Gemma 4 ${entry.variantLabel}. It offers a strong ` +
      `balance of quality and speed for everyday offline chat.`
    );
  }

  return (
    `Your device has ${ramGb} GB of RAM and ${diskGb} GB of free disk space. ` +
    `Gemma 4 ${entry.variantLabel} offers the best balance of quality and ` +
    `speed for your hardware.`
  );
}

/**
 * Build a human-readable explanation of a fallback recommendation decision
 * (Gemma 3 only — surfaced after repeated Gemma 4 install failures).
 */
function buildFallbackReason(entry: OfflineModelEntry, profile: HardwareProfile): string {
  const ramGb = Math.round(profile.totalRamGb);
  return (
    `Fallback option — Gemma 3 ${entry.variantLabel}. ` +
    `Your device has ${ramGb} GB of RAM, which is enough to run this variant ` +
    `if Gemma 4 keeps failing to install on your network.`
  );
}

function toProfileSummary(profile: HardwareProfile): OfflineProfileSummary {
  return {
    totalRamGb: Math.round(profile.totalRamGb * 10) / 10,
    freeDiskGb: Math.round(profile.freeDiskGb * 10) / 10,
    platform: String(profile.platform),
    arch: profile.arch,
    isAppleSilicon: profile.isAppleSilicon,
    cpuCores: profile.cpuCores,
  };
}

function toOfflineRecommendation(
  entry: OfflineModelEntry,
  reason: string,
  profileSummary: OfflineProfileSummary,
): OfflineRecommendation {
  return {
    modelId: entry.id,
    label: entry.name,
    variantLabel: entry.variantLabel,
    sizeGb: entry.sizeGb,
    tier: entry.tier,
    reason,
    profile: profileSummary,
    family: entry.family,
    isFallback: entry.isFallback,
  };
}

/**
 * Recommendation service — maps a hardware profile to the single best
 * **Gemma 4** catalog entry by default, and exposes an explicit Gemma 3
 * fallback list separately.
 *
 * `recommend()` only ever returns Gemma 4 entries.  The fallback list is
 * only consumed by the IPC layer after Gemma 4 has failed to install
 * repeatedly — and only as user-visible options that must be explicitly
 * chosen.  Never silently substituted.
 */
export const recommendationService = {
  /**
   * Return the single best **Gemma 4** recommendation for the given
   * profile, plus the renderer-ready `OfflineRecommendation` payload.
   *
   * Algorithm (Gemma-4 family only):
   * 1. Filter to entries whose RAM and disk requirements fit the device.
   * 2. Apple Silicon: prefer the largest fit (Metal makes big models fast).
   * 3. Non-Apple: prefer the largest fit but cap at 26B-A4B unless the
   *    machine has ≥ 48 GB RAM, in which case allow 31B dense.
   * 4. If nothing fits, fall back to the smallest Gemma 4 entry
   *    unconditionally with a marginal-fit explanation.
   */
  recommend(profile: HardwareProfile): ModelRecommendation & {
    offlineRecommendation: OfflineRecommendation;
  } {
    const all = offlineCatalog.listPreferred();

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
    let isMarginalFit = false;

    if (fits.length === 0) {
      // Nothing fits — pick the smallest unconditionally as a marginal option.
      // This still keeps us inside the Gemma 4 family — we never silently
      // substitute Gemma 3.
      chosen = platformCompatible[0] ?? all[0];
      isMarginalFit = true;
    } else if (profile.isAppleSilicon) {
      // Apple Silicon: pick the largest fitting entry (Metal makes big models fast).
      chosen = fits[fits.length - 1];
    } else {
      // Non-Apple: prefer the largest fitting entry but cap at 26B-A4B unless
      // the machine has a lot of RAM (≥ 48 GB), in which case allow 31B.
      const capped =
        profile.totalRamGb < 48
          ? fits.filter((e) => !e.id.startsWith("gemma4-31b"))
          : fits;
      const candidates = capped.length > 0 ? capped : fits;
      chosen = candidates[candidates.length - 1];
    }

    const reason = buildGemma4Reason(chosen, profile, isMarginalFit);
    const profileSummary = toProfileSummary(profile);
    const offlineRecommendation = toOfflineRecommendation(chosen, reason, profileSummary);

    return { model: chosen, reason, offlineRecommendation };
  },

  /**
   * Return ranked **Gemma 3 fallback** recommendations for the given
   * hardware profile.  Used by the IPC layer to populate the
   * `fallbackOptions` field of `OfflineReadiness` when Gemma 4 install
   * has failed repeatedly.
   *
   * Returns an empty list when no fallback variant fits the platform.
   * Never includes Gemma 4 entries.
   */
  recommendFallbacks(profile: HardwareProfile): OfflineRecommendation[] {
    const profileSummary = toProfileSummary(profile);
    const fallbacks = offlineCatalog
      .listFallbacks()
      .filter((e) => (e.platforms as string[]).includes(profile.platform));

    // Order: smallest entry that comfortably fits the device first
    // (most likely to succeed), followed by progressively larger options
    // for users who want better quality.
    const fitting = fallbacks
      .filter(
        (e) =>
          profile.totalRamGb >= e.ramRequiredGb &&
          profile.freeDiskGb >= e.diskRequiredGb * DISK_HEADROOM,
      )
      .sort((a, b) => a.sizeGb - b.sizeGb);

    // If nothing comfortably fits, surface the smallest entry anyway so
    // the user always has at least one explicit choice.
    if (fitting.length === 0 && fallbacks.length > 0) {
      const smallest = [...fallbacks].sort((a, b) => a.sizeGb - b.sizeGb)[0];
      return [toOfflineRecommendation(smallest, buildFallbackReason(smallest, profile), profileSummary)];
    }

    return fitting.map((entry) =>
      toOfflineRecommendation(entry, buildFallbackReason(entry, profile), profileSummary),
    );
  },

  /** Return ranked model recommendations for the given hardware profile. */
  async recommend_ranked(profile: HardwareProfile): Promise<ModelRecommendation[]> {
    const { model, reason } = this.recommend(profile);
    return [{ model, reason }];
  },
};
