"use client";

import React, { useState } from "react";
import { Icon } from "@/components/ui/Icons";
import { LiveDot } from "@/components/ui/Progress";

export function Sidebar({ active, onSelect }: { active: string; onSelect: (v: string) => void }) {
  const [isNarrow, setIsNarrow] = useState(false);
  const items = [
    { id: "scan",        label: "Body Scan",    icon: <Icon.Scan /> },
    { id: "vitals",      label: "Vitals",       icon: <Icon.Heart /> },
    { id: "history",     label: "History",      icon: <Icon.File /> },
    { id: "workflow",    label: "Methodology",  icon: <Icon.Cpu /> },
  ];
  return (
    <aside
      className={`flex w-full shrink-0 flex-col border-b lg:border-b-0 lg:border-r transition-all duration-300 ${
        isNarrow ? "lg:w-[68px]" : "lg:w-[var(--sidebar-w)]"
      }`}
      style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}
    >
      {/* Logo and Toggle */}
      <div className="flex items-center justify-between px-4 py-4 border-b h-[69px]" style={{ borderColor: "var(--color-border)" }}>
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0"
            style={{ background: "rgba(34,211,238,0.12)", border: "1px solid rgba(34,211,238,0.25)" }}>
            <span className="w-4 h-4 text-cyan-400"><Icon.Scan /></span>
          </div>
          {!isNarrow && <span className="text-sm font-semibold whitespace-nowrap transition-opacity duration-300" style={{ color: "var(--color-text-primary)" }}>Body Scan</span>}
        </div>
        {!isNarrow && (
          <button 
            onClick={() => setIsNarrow(true)}
            className="hidden lg:flex items-center justify-center w-6 h-6 rounded hover:bg-slate-800 transition-colors flex-shrink-0"
            title="Collapse Sidebar"
            style={{ color: "var(--color-text-muted)" }}
          >
            <span className="w-4 h-4 rotate-180"><Icon.ChevronRight /></span>
          </button>
        )}
      </div>

      {isNarrow && (
        <button 
          onClick={() => setIsNarrow(false)}
          className="hidden lg:flex mx-auto mt-2 items-center justify-center w-8 h-8 rounded hover:bg-slate-800 transition-colors"
          title="Expand Sidebar"
          style={{ color: "var(--color-text-muted)" }}
        >
          <span className="w-4 h-4"><Icon.ChevronRight /></span>
        </button>
      )}


      {/* Nav */}
      <nav className="flex-1 overflow-x-auto px-2 py-2 lg:overflow-visible lg:px-2 lg:py-3">
        <div className="flex gap-1 lg:flex-col lg:gap-0.5">
        {items.map(item => (
          <button key={item.id} onClick={() => onSelect(item.id)}
            title={isNarrow ? item.label : undefined}
            className={`nav-item whitespace-nowrap lg:w-full ${active === item.id ? "active" : ""} ${isNarrow ? "justify-center px-0" : ""}`}>
            <span className="w-4 h-4">{item.icon}</span>
            {!isNarrow && <span className="transition-opacity duration-300 overflow-hidden">{item.label}</span>}
          </button>
        ))}
        </div>
      </nav>

      {/* Footer */}
      {!isNarrow && (
        <div className="hidden px-3 py-3 border-t lg:block transition-opacity duration-300 overflow-hidden" style={{ borderColor: "var(--color-border)" }}>
          <div className="flex items-center gap-2 px-2 whitespace-nowrap">
            <LiveDot color="green" />
            <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>CSI Pipeline active</span>
          </div>
          <p className="text-xs mt-3 px-2 whitespace-nowrap" style={{ color: "var(--color-text-muted)" }}>
            Powered by Qwen AI &<br />RuView CSI sensing
          </p>
        </div>
      )}
    </aside>
  );
}
