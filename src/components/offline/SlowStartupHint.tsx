import { useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { SLOW_STARTUP_CAUSES } from "@/lib/offline-startup-format";

/**
 * Inline "Taking longer than usual…" disclosure surfaced when the
 * elapsed startup time exceeds the dynamic slow-startup threshold
 * (see `slowStartupThresholdMs`).  Lists the canonical possible
 * causes so the user can self-diagnose without leaving the chat or
 * Settings surface.
 *
 * Visual tone: amber (warning, not error) — startup may still
 * succeed.  Render conditionally; the component does no thresholding
 * itself, so callers must gate it.
 */
export function SlowStartupHint({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div
      className={cn(
        "rounded-md border border-amber-500/30 bg-amber-500/5 px-2.5 py-2 text-[11px] text-amber-300/90",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 text-left transition-colors hover:text-amber-200"
        aria-expanded={open}
      >
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <span className="font-medium">Taking longer than usual…</span>
        {open ? (
          <ChevronDown className="ml-auto h-3 w-3 shrink-0 opacity-70" />
        ) : (
          <ChevronRight className="ml-auto h-3 w-3 shrink-0 opacity-70" />
        )}
      </button>
      {open && (
        <ul className="mt-1.5 space-y-0.5 pl-4 text-[10.5px] text-amber-300/75">
          {SLOW_STARTUP_CAUSES.map((cause) => (
            <li key={cause} className="list-disc">
              {cause}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
