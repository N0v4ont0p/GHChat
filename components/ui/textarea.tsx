import { forwardRef } from "react";

import { cn } from "@/lib/utils";

export const Textarea = forwardRef<
  HTMLTextAreaElement,
  React.ComponentProps<"textarea">
>(({ className, ...props }, ref) => (
  <textarea
    ref={ref}
    className={cn(
      "min-h-[80px] w-full resize-none rounded-2xl border border-slate-700/80 bg-slate-900/80 px-4 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
      className,
    )}
    {...props}
  />
));
Textarea.displayName = "Textarea";
