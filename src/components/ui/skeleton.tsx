import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Subtle, premium loading placeholder. Uses a low-amplitude opacity
 * pulse rather than a moving shimmer so it never competes with content.
 *
 * Honors `prefers-reduced-motion` automatically — when reduced motion is
 * requested the element renders as a static muted block.
 */
const Skeleton = React.forwardRef<HTMLDivElement, React.HTMLAttributes<HTMLDivElement>>(
  ({ className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        "rounded-md bg-secondary/40 motion-safe:animate-pulse-subtle",
        className,
      )}
      aria-hidden="true"
      {...props}
    />
  ),
);
Skeleton.displayName = "Skeleton";

export { Skeleton };
