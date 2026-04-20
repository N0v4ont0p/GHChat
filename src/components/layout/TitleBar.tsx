export function TitleBar() {
  return (
    <div
      className="flex h-11 w-full items-center justify-center bg-transparent"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <span className="text-xs font-medium text-muted-foreground select-none">GHchat</span>
    </div>
  );
}
