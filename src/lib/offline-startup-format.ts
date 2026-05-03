import type { OfflineRuntimeStartupStats } from "@/types";

/**
 * Threshold (ms) below which a startup is "fast" enough that adding
 * an "elapsed Xs" badge would just be noise.  Matches the trail
 * elapsed-badge gate in OfflineSettingsTab so the chat indicator and
 * the settings panel agree on when to reveal a timer.
 */
export const STARTUP_ELAPSED_REVEAL_MS = 1_000;

/**
 * Floor below which we *never* call a slow startup "unusual", even if
 * it exceeds historical samples by a wide margin.  A 4s start that
 * exceeded a 2s history shouldn't trigger the warning UI — the
 * absolute time is still well within normal cold-boot territory for
 * llama.cpp.  Tuned empirically against typical 1–7B Q4 loads on
 * commodity laptops.
 */
export const SLOW_STARTUP_FLOOR_MS = 30_000;

/**
 * Multiplier on the historical max sample.  A startup exceeding
 * `max(history.maxMs * SLOW_STARTUP_MULTIPLIER, SLOW_STARTUP_FLOOR_MS)`
 * is treated as "unusually slow" and surfaces the SlowStartupHint UI.
 */
export const SLOW_STARTUP_MULTIPLIER = 1.5;

/**
 * Format a millisecond duration as a short human label suitable for
 * inline UI ("3s", "12s", "1m 4s").  Always rounds — sub-second
 * resolution would be jittery in the live elapsed timer.  Negative or
 * non-finite inputs are coerced to "0s" so callers don't have to guard.
 */
export function formatStartupDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0s";
  const totalSec = Math.round(ms / 1000);
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec - m * 60;
  return s === 0 ? `${m}m` : `${m}m ${s}s`;
}

/**
 * Format the "typical" range derived from a stats history.
 * Returns either "5–9s" (when min < max) or just "7s" (when only one
 * sample, or all samples equal).  Returns null when `stats` is null —
 * caller is responsible for hiding the row in that case.
 */
export function formatTypicalRange(
  stats: OfflineRuntimeStartupStats | null | undefined,
): string | null {
  if (!stats || stats.samples.length === 0) return null;
  const min = Math.min(...stats.samples);
  const max = Math.max(...stats.samples);
  if (min === max) return formatStartupDuration(min);
  return `${formatStartupDuration(min)}–${formatStartupDuration(max)}`;
}

/**
 * Compute the threshold past which an in-flight startup should be
 * surfaced as "unusually slow".  Anchored on the historical max with
 * a multiplier, but never below SLOW_STARTUP_FLOOR_MS so first-launch
 * cold boots don't trigger it.
 */
export function slowStartupThresholdMs(
  stats: OfflineRuntimeStartupStats | null | undefined,
): number {
  if (!stats || stats.samples.length === 0) return SLOW_STARTUP_FLOOR_MS;
  return Math.max(stats.maxMs * SLOW_STARTUP_MULTIPLIER, SLOW_STARTUP_FLOOR_MS);
}

/**
 * Possible causes surfaced in the SlowStartupHint disclosure.  Kept as
 * a single source of truth so the chat indicator and the settings
 * panel show identical wording — drift here would confuse users.
 */
export const SLOW_STARTUP_CAUSES: readonly string[] = [
  "First launch — the model file is being read from disk for the first time.",
  "Model is loading into memory — large quantizations need several seconds.",
  "Slow disk — HDDs and network drives can dramatically extend load time.",
  "Runtime issue — the llama.cpp server may be stuck (try Restart Runtime).",
  "Model is too heavy for this device — consider a smaller quantization.",
];
