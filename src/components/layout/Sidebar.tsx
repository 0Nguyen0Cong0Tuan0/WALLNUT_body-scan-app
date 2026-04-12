import React from "react";
import { Icon } from "@/components/ui/Icons";
import { LiveDot } from "@/components/ui/Progress";

export function Sidebar({ active, onSelect }: { active: string; onSelect: (v: string) => void }) {
  const items = [
    { id: "scan",        label: "Body Scan",    icon: <Icon.Scan /> },
    { id: "vitals",      label: "Vitals",       icon: <Icon.Heart /> },
    { id: "history",     label: "History",      icon: <Icon.File /> },
    { id: "workflow",    label: "Methodology",  icon: <Icon.Cpu /> },
  ];
  return (
    <aside
      className="flex w-full shrink-0 flex-col border-b lg:w-[var(--sidebar-w)] lg:border-b-0 lg:border-r"
      style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
    >
      {/* Logo */}
      <div className="flex items-center gap-2.5 px-4 py-4 border-b" style={{ borderColor: "var(--color-border)" }}>
        <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
          style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.25)" }}>
          <span className="w-4 h-4 text-cyan-400"><Icon.Scan /></span>
        </div>
        <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Body Scan</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-x-auto px-2 py-2 lg:overflow-visible lg:px-2 lg:py-3">
        <div className="flex gap-1 lg:flex-col lg:gap-0.5">
        {items.map(item => (
          <button key={item.id} onClick={() => onSelect(item.id)}
            className={`nav-item whitespace-nowrap lg:w-full ${active === item.id ? "active" : ""}`}>
            <span className="w-4 h-4">{item.icon}</span>
            {item.label}
          </button>
        ))}
        </div>
      </nav>

      {/* Footer */}
      <div className="hidden px-3 py-3 border-t lg:block" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2 px-2">
          <LiveDot color="green" />
          <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>CSI Pipeline active</span>
        </div>
        <p className="text-xs mt-3 px-2" style={{ color: "var(--color-text-muted)" }}>
          Powered by Qwen AI &<br />RuView CSI sensing
        </p>
      </div>
    </aside>
  );
}
