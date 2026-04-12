"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import dynamic from "next/dynamic";
import TrustNavigation from "@/components/TrustNavigation";
import HowItWorks from "@/components/HowItWorks";
import ChatAssistant from "@/components/ChatAssistant";
import type { RuViewFrame } from "@/lib/ruviewSimulator";
import { estimateCircumferences, MEASUREMENT_ORDER } from "@/lib/anthropometricModel";
import type { BodyCircumferences } from "@/lib/anthropometricModel";

// Body3DViewer uses Three.js / WebGL — must be client-only, no SSR
const Body3DViewer = dynamic(() => import("@/components/Body3DViewer"), {
  ssr: false,
  loading: () => (
    <div style={{ width: "100%", height: 380, background: "#0d1117", borderRadius: "0.625rem",
      display: "flex", alignItems: "center", justifyContent: "center", color: "#535f6d", fontSize: "0.75rem" }}>
      Loading 3D model…
    </div>
  ),
});

// ─── Types ────────────────────────────────────────────────────────────────────
type InputMode = "upload" | "live" | "simulate";
type ScanState = "idle" | "connecting" | "processing" | "analyzing" | "results" | "error";

interface Analysis {
  bodyFatPercent: number; bodyFatClassification: string; classColor: string;
  estimatedWaistCm: number; clinicalSummary: string; recommendations: string[];
  postureNotes: string; source: "qwen" | "rule-based";
}
interface CsiMeta {
  format: string; numFrames: number; durationSeconds: number;
  sampleRateHz: number; numAntennas: number; numSubcarriers: number;
}

interface PoseKeypoint {
  point: string;
  x: number;
  y: number;
  confidence: number;
  z?: number;
}

interface PoseSequenceFrame {
  t: number;
  keypoints: PoseKeypoint[];
  confidence: number;
  motionScore: number;
}

interface TemporalMeta {
  activity: string;
  activityConfidence: number;
  dominantMotionHz: number;
  breathingHz: number;
  motionEnergy: number;
  phaseStability: number;
  fps: number;
  sequenceLength: number;
  durationSeconds: number;
}

type ScanFrame = Omit<RuViewFrame, "keypoints"> & {
  keypoints: PoseKeypoint[];
  keypointSequence?: PoseSequenceFrame[];
  temporal?: TemporalMeta;
  csiMeta?: CsiMeta;
};

interface ScanRequest {
  mode: InputMode;
  file?: File;
  livePort?: number;
}

interface LiveStatusNode {
  nodeId: number;
  healthy: boolean;
  ageMs: number;
}

interface LiveStatusResponse {
  success: boolean;
  status?: {
    port: number;
    healthy: boolean;
    activeNodes: number;
    nodes: LiveStatusNode[];
  };
  error?: string;
}

// ─── Icons (inline SVG — no emoji) ───────────────────────────────────────────
const Icon = {
  Upload: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
    </svg>
  ),
  Wifi: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
    </svg>
  ),
  Dice: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14.25 6.087c0-.355.186-.676.401-.959.221-.29.349-.634.349-1.003 0-1.036-1.007-1.875-2.25-1.875s-2.25.84-2.25 1.875c0 .369.128.713.349 1.003.215.283.401.604.401.959v0a.64.64 0 01-.657.643 48.39 48.39 0 01-4.163-.3c.186 1.613.293 3.25.315 4.907a.656.656 0 01-.658.663v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.036 0-1.875 1.007-1.875 2.25s.84 2.25 1.875 2.25c.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0c.31 0 .555.26.532.57a48.039 48.039 0 01-.642 5.056c1.518.19 3.058.309 4.616.354a.64.64 0 00.657-.643v0c0-.355-.186-.676-.401-.959a1.647 1.647 0 01-.349-1.003c0-1.035 1.008-1.875 2.25-1.875 1.243 0 2.25.84 2.25 1.875 0 .369-.128.713-.349 1.003-.215.283-.401.604-.401.959v0c0 .31.26.555.57.532a48.025 48.025 0 005.056-.642c.19 1.518.309 3.058.354 4.616a.64.64 0 01-.643.657v0c-.355 0-.676-.186-.959-.401a1.647 1.647 0 00-1.003-.349c-1.035 0-1.875 1.008-1.875 2.25 0 1.243.84 2.25 1.875 2.25.369 0 .713-.128 1.003-.349.283-.215.604-.401.959-.401v0" />
    </svg>
  ),
  Play: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M5.25 5.653c0-.856.917-1.398 1.667-.986l11.54 6.347a1.125 1.125 0 010 1.972l-11.54 6.347a1.125 1.125 0 01-1.667-.986V5.653z" />
    </svg>
  ),
  Refresh: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
    </svg>
  ),
  ChevronRight: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
    </svg>
  ),
  Heart: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
    </svg>
  ),
  Lung: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v10.5m0 0A7.5 7.5 0 004.5 21h15A7.5 7.5 0 0012 13.5z" />
    </svg>
  ),
  Cpu: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 3v1.5M4.5 8.25H3m18 0h-1.5M4.5 12H3m18 0h-1.5m-15 3.75H3m18 0h-1.5M8.25 19.5V21M12 3v1.5m0 15V21m3.75-18v1.5m0 15V21m-9-1.5h10.5a2.25 2.25 0 002.25-2.25V6.75a2.25 2.25 0 00-2.25-2.25H6.75A2.25 2.25 0 004.5 6.75v10.5a2.25 2.25 0 002.25 2.25zm.75-12h9v9h-9v-9z" />
    </svg>
  ),
  Scan: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  ),
  File: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
    </svg>
  ),
  Lock: () => (
    <svg fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.75}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  ),
  Circle: ({ filled }: { filled?: boolean }) => (
    <svg viewBox="0 0 8 8" fill={filled ? "currentColor" : "none"} stroke="currentColor" strokeWidth={1.5}>
      <circle cx="4" cy="4" r="3" />
    </svg>
  ),
};

// ─── Status helpers ───────────────────────────────────────────────────────────
function statusBadgeClass(classification: string) {
  const m: Record<string, string> = {
    Healthy: "badge-healthy", Underfat: "badge-caution",
    Overfat: "badge-warning", Obese: "badge-danger",
  };
  return `inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold ${m[classification] ?? "badge-neutral"}`;
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function LiveDot({ color = "green" }: { color?: "green" | "cyan" | "yellow" | "red" }) {
  const c = { green: "bg-green-500", cyan: "bg-cyan-400", yellow: "bg-yellow-400", red: "bg-red-500" }[color];
  return (
    <span className="relative flex h-2 w-2 flex-shrink-0">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${c} opacity-60`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${c}`} />
    </span>
  );
}

// Horizontal progress bar
function ProgressBar({ value, max = 45, colorClass = "bg-green-500" }: { value: number; max?: number; colorClass?: string }) {
  const pct = Math.min(100, (value / max) * 100);
  return (
    <div className="h-1 w-full rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
      <div className={`h-full rounded-full transition-all duration-700 ${colorClass}`} style={{ width: `${pct}%` }} />
    </div>
  );
}

// Metric stat block
function StatBlock({ label, value, unit, color = "text-white" }: { label: string; value: number | string; unit?: string; color?: string }) {
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

// File drop zone
function FileDropZone({ onFile }: { onFile: (f: File) => void }) {
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

// ─── Processing View ──────────────────────────────────────────────────────────
function ProcessingView({ state, progress }: { state: ScanState; progress?: number | null }) {
  const steps = [
    { id: "processing", label: "DSP Filter & Vital Extraction" },
    { id: "analyzing",  label: "Qwen AI Clinical Analysis" },
  ];
  return (
    <div className="flex flex-col items-center gap-8 py-16">
      <div className="relative w-16 h-16">
        <div className="absolute inset-0 rounded-full border border-cyan-500/20 animate-spin" style={{ animationDuration: "3s" }} />
        <div className="absolute inset-2 rounded-full border border-cyan-500/40 animate-spin" style={{ animationDuration: "2s", animationDirection: "reverse" }} />
        <div className="absolute inset-4 rounded-full" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
          <div className="absolute inset-1 rounded-full border-t-2 border-cyan-500 animate-spin" />
        </div>
      </div>
      <div className="w-full max-w-xs space-y-3">
        {steps.map((s, i) => {
          const done = (state === "analyzing" && i === 0) || false;
          const active = (state === "processing" && i === 0) || (state === "analyzing" && i === 1);
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
  );
}

// ─── Results Panel ────────────────────────────────────────────────────────────
function ResultsPanel({ frame, analysis, csiMeta, inputSource, onRescan }: {
  frame: ScanFrame; analysis: Analysis;
  csiMeta?: CsiMeta; inputSource: string; onRescan: () => void;
}) {
  const fatPct = analysis.bodyFatPercent;
  const fatBarColor = { Underfat: "bg-yellow-500", Healthy: "bg-green-500", Overfat: "bg-orange-500", Obese: "bg-red-500" }[analysis.bodyFatClassification] ?? "bg-gray-500";

  // Anthropometric model: estimate all 8 circumferences from CSI sparse measurements
  const measurements: BodyCircumferences = useMemo(() => estimateCircumferences({
    heightCm:        frame.bodyMetrics.estimatedHeightCm,
    shoulderWidthCm: frame.bodyMetrics.shoulderWidthCm,
    hipWidthCm:      frame.bodyMetrics.hipWidthCm,
    torsoLengthCm:   frame.bodyMetrics.torsoLengthCm,
    leftArmLengthCm: frame.bodyMetrics.leftArmLengthCm,
    leftLegLengthCm: frame.bodyMetrics.leftLegLengthCm,
    bodyFatPercent:  fatPct,
  }), [frame.bodyMetrics, fatPct]);

  return (
    <div className="space-y-4 animate-[fadeIn_0.25s_ease-out]">
      {/* Report header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold" style={{ color: "var(--color-text-primary)" }}>Scan Report</h2>
          <p className="text-xs mt-0.5" style={{ color: "var(--color-text-muted)" }}>
            {new Date(frame.timestamp).toLocaleString()} &nbsp;·&nbsp;
            <span style={{ color: analysis.source === "qwen" ? "var(--color-brand)" : "" }}>
              {analysis.source === "qwen" ? "Qwen AI" : "Rule engine"}
            </span>
            &nbsp;·&nbsp;{inputSource}
          </p>
        </div>
        <button onClick={onRescan} className="btn-ghost flex items-center gap-1.5">
          <span className="w-3.5 h-3.5"><Icon.Refresh /></span>New Scan
        </button>
      </div>

      {/* CSI Metadata strip */}
      {csiMeta && (
        <div className="rounded-lg px-4 py-2.5 grid grid-cols-2 gap-3 md:grid-cols-3 2xl:grid-cols-6"
          style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
          {[
            ["Format", csiMeta.format], ["Frames", String(csiMeta.numFrames)],
            ["Duration", `${csiMeta.durationSeconds}s`], ["Rate", `${csiMeta.sampleRateHz} Hz`],
            ["Antennas", String(csiMeta.numAntennas)], ["Subcarriers", String(csiMeta.numSubcarriers)],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="label">{k}</p>
              <p className="metric text-xs mt-0.5" style={{ color: "var(--color-text-primary)" }}>{v}</p>
            </div>
          ))}
        </div>
      )}

      {/* Main 2-column body */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(520px,1.25fr)_minmax(320px,1fr)]">
        {/* Left: 3D Body Viewer + measurement table */}
        <div className="flex min-w-0 flex-col rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
          <Body3DViewer
            keypoints={frame.keypoints}
            keypointSequence={frame.keypointSequence}
            activity={frame.temporal?.activity}
            dominantMotionHz={frame.temporal?.dominantMotionHz}
            breathingHz={frame.temporal?.breathingHz}
            minHeight="clamp(500px, 66vh, 920px)"
            bodyMetrics={frame.bodyMetrics}
            bodyFatPercent={analysis.bodyFatPercent}
            classification={analysis.bodyFatClassification}
            measurements={measurements}
          />
          {/* Measurement table — mirrors reference image layout */}
          <div style={{ background: "var(--color-surface-2)", borderTop: "1px solid var(--color-border)", padding: "10px 12px" }}>
            <p className="label mb-2" style={{ color: "var(--color-text-muted)" }}>Body Measurements · SMPL-fit Anthropometric Model</p>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
              {MEASUREMENT_ORDER.map(({ key, label, isBiacromial }) => (
                <div key={key} className="flex items-center justify-between">
                  <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>{label}</span>
                  <span className="metric text-xs" style={{ color: "var(--color-text-primary)" }}>
                    {measurements[key]} cm
                    {isBiacromial && <span style={{ color: "var(--color-text-muted)", fontSize: "0.55rem", marginLeft: 2 }}>width</span>}
                  </span>
                </div>
              ))}
              <div className="flex items-center justify-between">
                <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>Height</span>
                <span className="metric text-xs" style={{ color: "var(--color-text-primary)" }}>{frame.bodyMetrics.estimatedHeightCm} cm</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1">
          {/* Temporal motion analysis */}
          {frame.temporal && (
            <div className="rounded-xl p-4 space-y-3"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <div className="flex items-center justify-between">
                <p className="label">Motion Replay</p>
                <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold badge-neutral">
                  {frame.temporal.activity}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <p className="label">Confidence</p>
                  <p className="metric text-sm" style={{ color: "var(--color-text-primary)" }}>
                    {(frame.temporal.activityConfidence * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="label">Frames</p>
                  <p className="metric text-sm" style={{ color: "var(--color-text-primary)" }}>
                    {frame.temporal.sequenceLength}
                  </p>
                </div>
                <div>
                  <p className="label">Dominant motion</p>
                  <p className="metric text-sm" style={{ color: "var(--color-text-primary)" }}>
                    {frame.temporal.dominantMotionHz.toFixed(2)} Hz
                  </p>
                </div>
                <div>
                  <p className="label">Playback rate</p>
                  <p className="metric text-sm" style={{ color: "var(--color-text-primary)" }}>
                    {frame.temporal.fps.toFixed(1)} fps
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Body composition */}
          <div className="rounded-xl p-4 space-y-3"
            style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <p className="label">Body Composition</p>
              <span className={statusBadgeClass(analysis.bodyFatClassification)}>
                <Icon.Circle filled />
                {analysis.bodyFatClassification}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <p className="metric text-5xl" style={{ color: "var(--color-text-primary)" }}>{fatPct}</p>
              <p className="text-lg mb-1" style={{ color: "var(--color-text-muted)" }}>% body fat</p>
            </div>
            <ProgressBar value={fatPct} max={45} colorClass={fatBarColor} />
            <div className="flex justify-between text-xs" style={{ color: "var(--color-text-muted)" }}>
              <span>5%</span><span>Underfat·Healthy·Overfat·Obese</span><span>45%</span>
            </div>

            <div className="grid grid-cols-2 gap-3 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              <StatBlock label="Est. Waist" value={analysis.estimatedWaistCm} unit="cm" />
              <StatBlock label="Torso" value={frame.bodyMetrics.torsoLengthCm} unit="cm" />
            </div>
          </div>

          {/* Vitals */}
          <div className="rounded-xl p-4"
            style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            <p className="label mb-3">Extracted Vitals</p>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-3.5 h-3.5 text-red-400"><Icon.Heart /></span>
                  <p className="label">Heart Rate</p>
                </div>
                <p className="metric text-2xl text-red-400">{frame.vitals.heartRate}<span className="text-sm text-slate-500 font-normal ml-0.5">bpm</span></p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-3.5 h-3.5 text-cyan-400"><Icon.Lung /></span>
                  <p className="label">Breathing</p>
                </div>
                <p className="metric text-2xl text-cyan-400">{frame.vitals.breathingRate}<span className="text-sm text-slate-500 font-normal ml-0.5">rpm</span></p>
              </div>
              <div>
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="w-3.5 h-3.5 text-violet-400"><Icon.Cpu /></span>
                  <p className="label">HRV</p>
                </div>
                <p className="metric text-2xl text-violet-400">{frame.vitals.hrv}<span className="text-sm text-slate-500 font-normal ml-0.5">ms</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Measurements table */}
      <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
        <div className="px-4 py-2.5 label" style={{ background: "var(--color-surface-2)", borderBottom: "1px solid var(--color-border)" }}>
          Body Measurements — CSI Spatial Analysis
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-3" style={{ background: "var(--color-surface-1)" }}>
          {[
            ["Left Arm", `${frame.bodyMetrics.leftArmLengthCm} cm`],
            ["Right Arm", `${frame.bodyMetrics.rightArmLengthCm} cm`],
            ["Left Leg", `${frame.bodyMetrics.leftLegLengthCm} cm`],
            ["Shoulder Width", `${frame.bodyMetrics.shoulderWidthCm} cm`],
            ["Hip Width", `${frame.bodyMetrics.hipWidthCm} cm`],
            ["Torso", `${frame.bodyMetrics.torsoLengthCm} cm`],
          ].map(([k, v]) => (
            <div key={k} className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
              <p className="label">{k}</p>
              <p className="metric text-sm mt-0.5" style={{ color: "var(--color-text-primary)" }}>{v}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Clinical Summary */}
      <div className="rounded-xl p-4 space-y-3"
        style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderLeft: "3px solid var(--color-brand)" }}>
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Clinical Summary</p>
          {analysis.source === "qwen" && (
            <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold badge-neutral">
              Qwen-Plus · AI
            </span>
          )}
        </div>
        <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{analysis.clinicalSummary}</p>
        <div className="space-y-2 pt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
          {analysis.recommendations.map((r, i) => (
            <div key={i} className="flex gap-2.5 text-sm">
              <span className="text-green-400 flex-shrink-0 mt-0.5">→</span>
              <span style={{ color: "var(--color-text-secondary)" }}>{r}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Posture note */}
      {analysis.postureNotes && (
        <div className="rounded-lg px-4 py-3 flex gap-3 items-start"
          style={{ background: "var(--color-surface-2)", border: "1px solid rgba(245,158,11,0.25)" }}>
          <span className="text-yellow-500 mt-0.5 flex-shrink-0 text-sm">⚑</span>
          <div>
            <p className="text-xs font-semibold text-yellow-500 mb-0.5">Posture Note</p>
            <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{analysis.postureNotes}</p>
          </div>
        </div>
      )}

      {/* ── RAG Chat Assistant ── */}
      <div className="rounded-xl overflow-hidden flex flex-col"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface-1)", minHeight: 480 }}>
        <ChatAssistant
          scanMetrics={{
            heartRateBpm:          frame.vitals.heartRate,
            breathingRateBpm:      frame.vitals.breathingRate,
            hrv:                   frame.vitals.hrv,
            bodyFatPercent:        analysis.bodyFatPercent,
            bodyFatClassification: analysis.bodyFatClassification,
            estimatedHeightCm:     frame.bodyMetrics.estimatedHeightCm,
            shoulderWidthCm:       frame.bodyMetrics.shoulderWidthCm,
            hipWidthCm:            frame.bodyMetrics.hipWidthCm,
            activity:              frame.temporal?.activity ?? "unknown",
            activityConfidence:    frame.temporal?.activityConfidence ?? 0.7,
            clinicalSummary:       analysis.clinicalSummary,
          }}
        />
      </div>

      {/* ── How It Works — collapsible pipeline explainer ── */}
      <HowItWorksPanelWrapper />

      <p className="text-center text-xs pb-2" style={{ color: "var(--color-text-muted)" }}>
        <span className="w-3 h-3 inline-block mr-1"><Icon.Lock /></span>
        No camera. No biometric storage. WiFi RF analysis only.
      </p>
    </div>
  );
}

// ─── How It Works wrapper (collapsible panel) ────────────────────────────────
function HowItWorksPanelWrapper() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-border)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left"
        style={{ background: "var(--color-surface-2)", border: "none", cursor: "pointer" }}
      >
        <div className="flex items-center gap-2.5">
          <svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth={1.75}
            style={{ width: 16, height: 16, flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 01-6.23-.607L5 14.5m14.8.5l.391 1.561a2.25 2.25 0 01-2.185 2.814H6.001a2.25 2.25 0 01-2.185-2.814L4.198 15" />
          </svg>
          <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
            How WALLNUT Works — Pipeline Explainer
          </span>
          <span className="text-xs px-2 py-0.5 rounded" style={{
            background: "#22d3ee12", color: "#22d3ee", border: "1px solid #22d3ee30",
            fontSize: "0.62rem", fontWeight: 600, letterSpacing: "0.05em", textTransform: "uppercase",
          }}>5 Stages</span>
        </div>
        <span style={{
          color: "#4a8fa8", fontSize: "0.8rem",
          transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "inline-block",
        }}>▾</span>
      </button>
      {open && (
        <div className="p-4" style={{ background: "var(--color-surface-1)" }}>
          <HowItWorks />
        </div>
      )}
    </div>
  );
}

// ─── Idle / Input Panel ───────────────────────────────────────────────────────
function InputPanel({ onScan, error, uploadProgress }: {
  onScan: (request: ScanRequest) => void;
  error: string | null;
  uploadProgress: number | null;
}) {
  const [mode, setMode] = useState<InputMode>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [livePort, setLivePort] = useState("8080");
  const [liveStatus, setLiveStatus] = useState<LiveStatusResponse["status"] | null>(null);
  const [liveStatusLoading, setLiveStatusLoading] = useState(false);
  const [liveStatusError, setLiveStatusError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "live") return;

    const parsedPort = Number(livePort);
    if (!Number.isFinite(parsedPort) || parsedPort < 1 || parsedPort > 65535) {
      setLiveStatus(null);
      setLiveStatusError("Live port must be between 1 and 65535.");
      return;
    }

    let cancelled = false;

    const pullStatus = async () => {
      try {
        setLiveStatusLoading(true);
        const response = await fetch(`/api/v1/status?port=${parsedPort}&timeoutMs=35`, { cache: "no-store" });
        const data = (await response.json()) as LiveStatusResponse;
        if (cancelled) return;
        if (!response.ok || !data.success) {
          setLiveStatus(null);
          setLiveStatusError(data.error ?? "Unable to read mesh status.");
          return;
        }
        setLiveStatus(data.status ?? null);
        setLiveStatusError(null);
      } catch (statusError) {
        if (cancelled) return;
        setLiveStatus(null);
        setLiveStatusError(statusError instanceof Error ? statusError.message : "Unable to read mesh status.");
      } finally {
        if (!cancelled) setLiveStatusLoading(false);
      }
    };

    void pullStatus();
    const intervalId = setInterval(() => {
      void pullStatus();
    }, 3000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [mode, livePort]);

  const tabClass = (m: InputMode) =>
    `flex-1 flex items-center justify-center gap-2 py-2 text-xs font-medium rounded-md transition-colors cursor-pointer ${
      mode === m
        ? "text-cyan-400 bg-cyan-500/10 border border-cyan-500/30"
        : "border border-transparent hover:border-[var(--color-border)]"
    }`;

  const parsedLivePort = Number(livePort);
  const validLivePort = Number.isFinite(parsedLivePort) && parsedLivePort >= 1 && parsedLivePort <= 65535;
  const runDisabled = (mode === "upload" && !file) || (mode === "live" && !validLivePort);

  return (
    <div className="space-y-5">
      {/* Mode selector */}
      <div>
        <p className="label mb-2">Input Source</p>
        <div className="flex gap-1.5 p-1 rounded-lg" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
          {(["upload","live","simulate"] as InputMode[]).map(m => (
            <button key={m} className={tabClass(m)} onClick={() => setMode(m)}>
              <span className="w-3.5 h-3.5">
                {m === "upload" ? <Icon.Upload /> : m === "live" ? <Icon.Wifi /> : <Icon.Dice />}
              </span>
              {m === "upload" ? "File Upload" : m === "live" ? "Live Device" : "Simulate"}
            </button>
          ))}
        </div>
      </div>

      {/* Mode content */}
      {mode === "upload" && <FileDropZone onFile={setFile} />}

      {mode === "live" && (
        <div className="space-y-3">
          <div className="rounded-lg px-3 py-2.5 text-sm" style={{ background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.2)", color: "var(--color-text-secondary)" }}>
            Requires active CSI UDP traffic from ESP32 nodes. Live scans are blocked when hardware traffic is absent.
          </div>
          <div>
            <label className="label block mb-1.5">CSI UDP Port</label>
            <input
              type="number"
              min={1}
              max={65535}
              value={livePort}
              onChange={e => setLivePort(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm font-mono outline-none focus:ring-1 focus:ring-cyan-500/50"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-primary)" }} />
          </div>

          <div className="rounded-lg px-3 py-2.5 text-xs space-y-1.5" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--color-text-muted)" }}>Mesh health</span>
              <span style={{ color: liveStatus?.healthy ? "#34d399" : "#f87171" }}>
                {liveStatusLoading
                  ? "Checking..."
                  : liveStatus?.healthy
                  ? "Healthy"
                  : "No active nodes"}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span style={{ color: "var(--color-text-muted)" }}>Active nodes</span>
              <span style={{ color: "var(--color-text-primary)" }}>{liveStatus?.activeNodes ?? 0}</span>
            </div>
            {liveStatusError && (
              <p className="text-[11px]" style={{ color: "#f87171" }}>{liveStatusError}</p>
            )}
          </div>

          <ol className="text-xs space-y-1.5 list-decimal list-inside" style={{ color: "var(--color-text-muted)" }}>
            <li>Flash <code className="text-cyan-500">esp32-csi-node.bin</code> from RuView releases</li>
            <li>Start CSI UDP stream (RuView record or sensing service)</li>
            <li>Use the same UDP port here and run live scan</li>
          </ol>
        </div>
      )}

      {mode === "simulate" && (
        <div className="rounded-lg p-4 text-sm space-y-2" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}>
          <p className="font-medium" style={{ color: "var(--color-text-primary)" }}>Simulation Mode</p>
          <p>Runs the full DSP pipeline with mathematically generated CSI data. Identical Qwen analysis. Used when no recording is available.</p>
          <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>Tip: generate real sample files with <code className="text-cyan-500">python test_data/signal/generate_signals.py</code></p>
        </div>
      )}

      {/* Action */}
      <button
        id="run-scan-btn"
        onClick={() => {
          if (runDisabled) return;
          onScan({
            mode,
            file: mode === "upload" ? file ?? undefined : undefined,
            livePort: mode === "live" ? parsedLivePort : undefined,
          });
        }}
        disabled={runDisabled}
        className="btn-primary w-full"
      >
        <span className="w-4 h-4"><Icon.Play /></span>
        {mode === "upload" && file
          ? `Analyze "${file.name}"`
          : mode === "upload"
          ? "Select a file above"
          : mode === "live"
          ? "Validate Hardware & Scan"
          : "Run Simulated Scan"}
      </button>

      {mode === "upload" && typeof uploadProgress === "number" && (
        <div className="rounded-lg p-3" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
          <div className="flex items-center justify-between text-xs mb-1.5">
            <span style={{ color: "var(--color-text-muted)" }}>File processing progress</span>
            <span style={{ color: "var(--color-text-primary)" }}>{Math.round(uploadProgress)}%</span>
          </div>
          <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--color-border)" }}>
            <div
              className="h-full rounded-full bg-cyan-500 transition-all duration-200"
              style={{ width: `${Math.max(0, Math.min(100, uploadProgress))}%` }}
            />
          </div>
        </div>
      )}

      {error && (
        <p className="text-xs text-center text-red-400 px-2 py-1.5 rounded" style={{ background: "rgba(239,68,68,0.06)", border: "1px solid rgba(239,68,68,0.2)" }}>{error}</p>
      )}
    </div>
  );
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────
function Sidebar({ active, onSelect }: { active: string; onSelect: (v: string) => void }) {
  const items = [
    { id: "scan",     label: "Body Scan",     icon: <Icon.Scan /> },
    { id: "vitals",   label: "Vitals",        icon: <Icon.Heart /> },
    { id: "workflow", label: "Methodology",   icon: <Icon.Cpu /> },
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

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function Home() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [frame, setFrame] = useState<ScanFrame | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [csiMeta, setCsiMeta] = useState<CsiMeta | undefined>(undefined);
  const [inputSource, setInputSource] = useState("simulated");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [activePage, setActivePage] = useState("scan");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);

  const runScan = useCallback(async (request: ScanRequest) => {
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
    setErrorMsg(null);
    setFrame(null);
    setAnalysis(null);
    setUploadProgress(null);
    setScanState(request.mode === "live" ? "connecting" : "processing");

    try {
      const applyResult = (data: { frame: ScanFrame; analysis: Analysis; inputSource: string }) => {
        setFrame(data.frame);
        setAnalysis(data.analysis);
        setCsiMeta(data.frame.csiMeta);
        setInputSource(data.inputSource);
      };

      if (request.mode === "upload") {
        if (!request.file) {
          throw new Error("Please choose a CSI file before starting upload mode.");
        }

        const form = new FormData();
        form.append("csiFile", request.file);
        const startResponse = await fetch("/api/scan/upload", { method: "POST", body: form });
        const startData = await startResponse.json();
        if (!startResponse.ok || !startData.success) {
          throw new Error(startData.error ?? "Upload job failed to start.");
        }

        const jobId = String(startData.jobId);
        for (let attempt = 0; attempt < 240; attempt++) {
          const progressResponse = await fetch(`/api/scan/upload/progress?jobId=${encodeURIComponent(jobId)}`, {
            cache: "no-store",
          });
          const progressData = await progressResponse.json();
          if (!progressResponse.ok || !progressData.success) {
            throw new Error(progressData.error ?? "Unable to read upload progress.");
          }

          const progressValue = Number(progressData.progress ?? 0);
          setUploadProgress(Number.isFinite(progressValue) ? progressValue : null);

          const stage = String(progressData.stage ?? "");
          if (stage === "validating" || stage === "decoding_binary" || stage === "parsing") {
            setScanState("processing");
          } else if (stage === "inference") {
            setScanState("analyzing");
          }

          if (stage === "completed" && progressData.result) {
            applyResult(progressData.result as { frame: ScanFrame; analysis: Analysis; inputSource: string });
            setScanState("results");
            setUploadProgress(100);
            return;
          }

          if (stage === "failed") {
            throw new Error(progressData.error?.message ?? "Upload processing failed.");
          }

          await sleep(250);
        }

        throw new Error("Upload processing timed out.");
      }

      setScanState(request.mode === "live" ? "connecting" : "processing");
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: request.mode,
          livePort: request.livePort,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error ?? "Scan failed.");
      }

      setScanState("analyzing");
      applyResult(data as { frame: ScanFrame; analysis: Analysis; inputSource: string });
      setScanState("results");
    } catch (err) {
      setErrorMsg(String(err));
      setScanState("error");
      setUploadProgress(null);
    }
  }, []);

  const handleReset = () => { setScanState("idle"); setFrame(null); setAnalysis(null); setErrorMsg(null); setUploadProgress(null); };

  return (
    <div className="flex min-h-screen h-dvh flex-col overflow-hidden lg:flex-row" style={{ fontFamily: "var(--font-sans)" }}>
      <Sidebar active={activePage} onSelect={setActivePage} />

      {/* Main area */}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        {/* Content */}
        <main className="flex-1 overflow-y-auto min-h-0">
          {activePage === "scan" && (
            <div className="grid h-full min-h-0 grid-cols-1 xl:grid-cols-[minmax(320px,360px)_minmax(0,1fr)]">
              {/* Left panel — input */}
              <div className="overflow-y-auto p-4 space-y-4 sm:p-5 border-b xl:border-b-0 xl:border-r" style={{ borderColor: "var(--color-border)" }}>
                <InputPanel onScan={runScan} error={errorMsg} uploadProgress={uploadProgress} />
              </div>

              {/* Right panel — results / states */}
              <div className="overflow-y-auto p-4 sm:p-5 min-w-0">
                {scanState === "idle" && (
                  <div className="flex flex-col items-center justify-center h-full min-h-[400px] gap-4">
                    <div style={{ color: "var(--color-border-hi)" }}>
                      <svg className="w-24 h-24" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={0.75}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 3.75H6A2.25 2.25 0 003.75 6v1.5M16.5 3.75H18A2.25 2.25 0 0120.25 6v1.5m0 9V18A2.25 2.25 0 0118 20.25h-1.5m-9 0H6A2.25 2.25 0 013.75 18v-1.5M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div className="text-center max-w-xs">
                      <p className="text-sm font-medium mb-1" style={{ color: "var(--color-text-secondary)" }}>No scan data</p>
                      <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                        Select an input mode on the left, upload a CSI file or run a simulation, then click Analyze.
                      </p>
                    </div>
                  </div>
                )}
                {(scanState === "connecting" || scanState === "processing" || scanState === "analyzing") && (
                  <ProcessingView state={scanState} progress={uploadProgress} />
                )}
                {scanState === "error" && (
                  <div className="rounded-xl p-5 space-y-3 max-w-lg"
                    style={{ background: "rgba(239,68,68,0.05)", border: "1px solid rgba(239,68,68,0.2)" }}>
                    <p className="text-sm font-semibold text-red-400">Scan failed</p>
                    <p className="text-sm" style={{ color: "var(--color-text-secondary)" }}>{errorMsg}</p>
                    <button onClick={handleReset} className="btn-ghost text-xs">Dismiss</button>
                  </div>
                )}
                {scanState === "results" && frame && analysis && (
                  <ResultsPanel frame={frame} analysis={analysis} csiMeta={csiMeta} inputSource={inputSource} onRescan={handleReset} />
                )}
              </div>
            </div>
          )}

          {activePage === "vitals" && (
            <div className="p-6">
              <div className="rounded-xl p-8 text-center max-w-md mx-auto"
                style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                <p className="text-sm" style={{ color: "var(--color-text-muted)" }}>Run a body scan first to view extracted vitals here.</p>
              </div>
            </div>
          )}

          {activePage === "workflow" && (
            <div className="p-6 max-w-6xl space-y-4">
              <div className="rounded-xl px-4 py-3 sm:px-5 sm:py-4" style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
                <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>Methodology Hub</p>
                <p className="text-xs mt-1.5 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                  This is the single source for workflow, logic, clinical usage, research basis, and privacy boundaries.
                  It mirrors the current implementation in the scan API and CSI processing modules.
                </p>
              </div>
              <TrustNavigation forceOpen="workflow" />
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
