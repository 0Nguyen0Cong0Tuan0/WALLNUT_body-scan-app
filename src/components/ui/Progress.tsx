import React from "react";

export function LiveDot({ color = "green" }: { color?: "green" | "cyan" | "yellow" | "red" }) {
  const c = { green: "bg-green-500", cyan: "bg-cyan-400", yellow: "bg-yellow-400", red: "bg-red-500" }[color];
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c} opacity-60`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}

export function ProgressBar({ value, max = 45, colorClass = "bg-green-500" }: { value: number; max?: number; colorClass?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
      <div className={`h-full rounded-full transition-all duration-700 ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}
