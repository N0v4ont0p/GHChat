export function TitleBar() {
  return (
    <div
      className="relative flex h-11 w-full shrink-0 items-center justify-center bg-transparent"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* App name — center-aligned, traffic lights sit left */}
      <span className="select-none text-xs font-medium text-muted-foreground/60 tracking-wide">
        GHchat
      </span>
    </div>
  );
}
