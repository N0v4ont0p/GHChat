import { useState, type ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "@/lib/utils";

interface TechnicalDetailsProps {
  /** Raw text shown inside the disclosure (e.g. error message + cause chain). */
  details?: string | null;
  /** Optional richer body — overrides `details` when provided. */
  children?: ReactNode;
  /** Label rendered next to the chevron. */
  label?: string;
  /** Label when the disclosure is open. Defaults to `Hide ${label}`. */
  openLabel?: string;
  className?: string;
  /** Tone of the panel — affects border / text colors. */
  tone?: "default" | "danger" | "warning";
}

/**
 * Reusable disclosure for hiding raw technical error info behind an
 * expandable "Show technical details" toggle.  Used by every error
 * surface (chat error panel, sidebar DB-unavailable, sidebar error
 * boundary, offline management modal banner) so users always get a
 * friendly summary first and can opt-in to the raw text only when
 * they want it.
 *
 * Renders nothing when there is no `details` and no `children` — this
 * keeps callers simple (they can pass an optional value without a
 * conditional).
 */
export function TechnicalDetails({
  details,
  children,
  label = "technical details",
  openLabel,
  className,
  tone = "default",
}: TechnicalDetailsProps) {
  const [open, setOpen] = useState(false);

  const hasContent =
    children !== undefined && children !== null
      ? true
      : typeof details === "string" && details.trim().length > 0;
  if (!hasContent) return null;

  const toneText =
    tone === "danger"
      ? "text-red-300/80"
      : tone === "warning"
        ? "text-amber-300/80"
        : "text-muted-foreground/80";
  const toneBorder =
    tone === "danger"
      ? "border-red-500/20"
      : tone === "warning"
        ? "border-amber-500/30"
        : "border-border/40";

  return (
    <div className={cn("text-left", className)}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex items-center gap-1 text-[11px] text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        {open ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        {open ? (openLabel ?? `Hide ${label}`) : `Show ${label}`}
      </button>
      {open && (
        <div
          className={cn(
            "mt-1.5 max-h-48 overflow-auto rounded-md border bg-muted/30 px-2.5 py-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap break-words",
            toneBorder,
            toneText,
          )}
        >
          {children ?? details}
        </div>
      )}
    </div>
  );
}
