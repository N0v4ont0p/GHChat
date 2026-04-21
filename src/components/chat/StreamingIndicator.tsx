export function StreamingIndicator() {
  return (
    <div className="flex items-center gap-2 px-6 py-4">
      <div className="flex items-end gap-[3px] h-4">
        {[0, 1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className="inline-block w-[3px] rounded-full bg-primary/70 animate-wave origin-bottom"
            style={{
              animationDelay: `${i * 0.11}s`,
              height: "100%",
            }}
          />
        ))}
      </div>
      <span className="text-xs text-muted-foreground/60 animate-pulse-subtle">
        Generating…
      </span>
    </div>
  );
}
