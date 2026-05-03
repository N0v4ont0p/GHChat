// ── Mode accent system ───────────────────────────────────────────────────────
//
// Single source of truth for the per-mode color accents used across the
// chrome.  Surfaces that should react to the current backend mode (mode
// badges, status dots, selected model cards, progress fills, etc.) read
// their classes from here so the palette stays in sync everywhere.
//
// Palette (intentionally restrained — premium, not flashy):
//   Online   blue   — paired with the primary purple for the brand
//   Offline  emerald — green/teal, signals "running locally"
//   Auto     amber   — gold, signals "smart routing"

import type { AppMode } from "@/types";

export interface ModeAccent {
  /** Human-readable label, ready for badges/tooltips. */
  label: string;
  /** Subtle pill: low-alpha bg + matching border + readable text. */
  badge: string;
  /** Solid pill (more saturated) — used for the ACTIVE state of the mode switcher. */
  badgeSolid: string;
  /** Background color class for a 1.5×1.5 status dot. */
  dot: string;
  /** Ring + bg classes for a "selected" card frame (e.g. active offline model). */
  selectedCard: string;
  /** Progress-bar fill class (used for streaming/loading bars). */
  progressFill: string;
  /** Progress-bar track class. */
  progressTrack: string;
  /** Hex/Tailwind text-* class for a standalone foreground accent. */
  text: string;
}

export const MODE_ACCENT: Record<AppMode, ModeAccent> = {
  online: {
    label: "Online",
    badge: "border-blue-500/30 bg-blue-500/10 text-blue-300",
    badgeSolid: "bg-blue-500/20 text-blue-300",
    dot: "bg-blue-400/80",
    selectedCard: "border-blue-500/40 ring-1 ring-blue-500/20",
    progressFill: "bg-blue-500/60",
    progressTrack: "bg-blue-500/10",
    text: "text-blue-300",
  },
  offline: {
    label: "Offline",
    badge: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
    badgeSolid: "bg-emerald-500/20 text-emerald-300",
    dot: "bg-emerald-400/80",
    selectedCard: "border-emerald-500/40 ring-1 ring-emerald-500/20",
    progressFill: "bg-emerald-500/60",
    progressTrack: "bg-emerald-500/10",
    text: "text-emerald-300",
  },
  auto: {
    label: "Auto",
    badge: "border-amber-500/30 bg-amber-500/10 text-amber-300",
    badgeSolid: "bg-amber-500/20 text-amber-300",
    dot: "bg-amber-400/80",
    selectedCard: "border-amber-500/40 ring-1 ring-amber-500/20",
    progressFill: "bg-amber-500/60",
    progressTrack: "bg-amber-500/10",
    text: "text-amber-300",
  },
};

/** Convenience getter. Defensive fallback to Online if an invalid mode slips through. */
export function getModeAccent(mode: AppMode): ModeAccent {
  return MODE_ACCENT[mode] ?? MODE_ACCENT.online;
}
