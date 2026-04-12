"use client";

import React from "react";
import dynamic from "next/dynamic";
import { AnalysisModelId, ScanState } from "./types";

const SignalVizPanelClient = dynamic(() => import("@/components/SignalVizPanel"), { ssr: false });
const LivePoseFusionClient = dynamic(() => import("@/components/LivePoseFusion"), { ssr: false });

function resolveAnalysisLabel(model: AnalysisModelId): string {
  if (model === "qwen-plus") return "Qwen Plus Clinical Analysis";
  if (model === "qwen-turbo") return "Qwen Turbo Clinical Analysis";
  if (model === "qwen-max") return "Qwen Max Clinical Analysis";
  return "Rule Engine Clinical Summary";
}

export function ProcessingView({
  state,
  progress,
  mode,
  analysisModel,
}: {
  state: ScanState;
  progress?: number | null;
  mode?: "upload" | "live" | "simulate" | null;
  analysisModel?: AnalysisModelId;
}) {
  const selectedModel = analysisModel ?? "none";
  const modelAnalysisEnabled = selectedModel !== "none";
  const steps = modelAnalysisEnabled
    ? [
        { id: "processing", label: "DSP Filter & Vital Extraction" },
        { id: "analyzing", label: resolveAnalysisLabel(selectedModel) },
      ]
    : [{ id: "processing", label: "DSP Filter, Vital Extraction & Rule Summary" }];
  return (
    <div className="flex flex-col gap-8 py-8 w-full max-w-7xl mx-auto">
      {/* Visual Telemetry (Observatory embedded here) */}
      {mode === "live" && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 w-full">
          <div className="lg:col-span-12 flex items-center justify-between">
            <div>
              <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Active Scan Telemetry</p>
              <p className="text-xs mt-1 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                Analyzing live CSI multipath signals...
              </p>
            </div>
            <div className="flex items-center gap-2">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
              </span>
              <span className="text-xs text-cyan-400 font-medium">Monitoring</span>
            </div>
          </div>
          
          <div className="lg:col-span-8 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface-2)' }}>
             <SignalVizPanelClient compact />
          </div>
          <div className="lg:col-span-4 rounded-xl overflow-hidden border" style={{ borderColor: 'var(--color-border)', backgroundColor: 'var(--color-surface-2)' }}>
             <LivePoseFusionClient height={380} />
          </div>
        </div>
      )}

      {/* Progress tracking */}
      <div className="flex flex-col items-center gap-6 mt-8">
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rounded-full border border-cyan-500/20 animate-spin" style={{ animationDuration: "3s" }} />
          <div className="absolute inset-2 rounded-full border border-cyan-500/40 animate-spin" style={{ animationDuration: "2s", animationDirection: "reverse" }} />
          <div className="absolute inset-4 rounded-full" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            <div className="absolute inset-1 rounded-full border-t-2 border-cyan-500 animate-spin" />
          </div>
        </div>

        <div className="w-full max-w-sm space-y-3">
          {steps.map((s, i) => {
            const done = modelAnalysisEnabled ? state === "analyzing" && i === 0 : false;
            const active = modelAnalysisEnabled
              ? (state === "processing" && i === 0) || (state === "analyzing" && i === 1)
              : (state === "processing" || state === "analyzing") && i === 0;
            return (
              <div key={s.id} className="flex items-center gap-3">
                <div className={`w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                  done ? "bg-green-500/20 text-green-400 border border-green-500/40" :
                  active ? "bg-cyan-500/20 text-cyan-400 border border-cyan-500/40" :
                  "border text-transparent"
                }`} style={{ borderColor: done || active ? "" : "var(--color-border)" }}>
                  {done ? "✓" : active ? <div className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse" /> : ""}
                </div>
                <span className={`text-sm ${active ? "text-cyan-300" : done ? "text-green-400" : ""}`}
                  style={{ color: active || done ? "" : "var(--color-text-muted)" }}>{s.label}</span>
              </div>
            );
          })}
          {typeof progress === "number" && (
            <div className="pt-2">
              <div className="flex items-center justify-between text-[11px] mb-1" style={{ color: "var(--color-text-muted)" }}>
                <span>Upload pipeline</span>
                <span>{Math.round(progress)}%</span>
              </div>
              <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
                <div
                  className="h-full rounded-full bg-cyan-500 transition-all duration-200"
                  style={{ width: `${Math.max(0, Math.min(100, progress))}%` }}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
