import React from "react";

export function StatBlock({ label, value, unit, color = "text-white" }: { label: string; value: number | string; unit?: string; color?: string }) {
  return (
    <div>
      <p className="label mb-1">{label}</p>
      <p className={`metric text-2xl ${color}`}>
        {value}
        {unit && <span className="text-sm font-normal ml-0.5" style={{ color: "var(--color-text-muted)" }}>{unit}</span>}
      </p>
    </div>
  );
}
