"use client";

import React, { useState, useRef } from "react";
import { Icon } from "@/components/ui/Icons";
import { LiveDot } from "@/components/ui/Progress";

export function FileDropZone({ onFile }: { onFile: (f: File) => void }) {
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const ref = useRef<HTMLInputElement>(null);

  const accept = (f: File) => { setFile(f); onFile(f); };

  return (
    <div className="space-y-3">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); const f = e.dataTransfer.files[0]; if (f) accept(f); }}
        onClick={() => ref.current?.click()}
        className={`relative flex flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-8 cursor-pointer text-center transition-colors ${
          dragging ? "border-cyan-500 bg-cyan-500/5" : "hover:border-[var(--color-border-hi)]"
        }`}
        style={{ borderColor: dragging ? "" : "var(--color-border)" }}
      >
        <input ref={ref} type="file" accept=".json,.jsonl,.csi.jsonl,.bin,.csi.bin" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) accept(f); }} />
        <div className="w-8 h-8 text-cyan-500"><Icon.Upload /></div>
        <div>
          <p className="text-sm font-medium" style={{ color: "var(--color-text-primary)" }}>Drop CSI file here</p>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>.csi.jsonl, proof JSON, or RuView .bin</p>
        </div>
      </div>

      {file && (
        <div className="flex items-center gap-2.5 rounded-lg px-3 py-2" style={{ background: "var(--color-surface-3)", border: "1px solid var(--color-border-hi)" }}>
          <div className="w-4 h-4 flex-shrink-0" style={{ color: "var(--color-brand)" }}><Icon.File /></div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-medium truncate" style={{ color: "var(--color-text-primary)" }}>{file.name}</p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>{(file.size / 1024).toFixed(1)} KB</p>
          </div>
          <LiveDot color="green" />
        </div>
      )}
    </div>
  );
}
