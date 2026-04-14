"use client";

import React, { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import { Icon } from "@/components/ui/Icons";
import { ProgressBar } from "@/components/ui/Progress";
import { StatBlock } from "@/components/ui/StatBlock";
import HowItWorks from "@/components/HowItWorks";
import ChatWithAI from "@/components/ChatWithAI";
import { estimateCircumferences, MEASUREMENT_ORDER, BodyCircumferences } from "@/lib/anthropometricModel";
import { ScanFrame, Analysis, CsiMeta, ScanDiagnostics } from "./types";

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

// Simple markdown parser for clinical summary
function parseMarkdown(text: string): React.ReactNode {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let inList = false;
  let listItems: React.ReactNode[] = [];

  const flushList = () => {
    if (listItems.length > 0) {
      elements.push(
        <ul key={`ul-${elements.length}`} className="list-disc list-inside ml-4 my-2 space-y-1">
          {listItems}
        </ul>
      );
      listItems = [];
    }
    inList = false;
  };

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    
    // Headers with **text**
    if (trimmed.startsWith("**") && trimmed.endsWith("**") && trimmed.length > 4) {
      flushList();
      elements.push(
        <h3 key={idx} className="text-base font-bold mt-4 mb-2 text-white">
          {parseInlineMarkdown(trimmed)}
        </h3>
      );
    } else if (trimmed.startsWith("- ") || trimmed.startsWith("• ")) {
      // List items
      inList = true;
      listItems.push(
        <li key={idx} className="text-sm leading-relaxed">
          {parseInlineMarkdown(trimmed.substring(2))}
        </li>
      );
    } else if (trimmed === "") {
      // Empty line
      if (inList) {
        flushList();
      }
    } else {
      flushList();
      elements.push(
        <p key={idx} className="text-sm leading-relaxed mb-2">
          {parseInlineMarkdown(trimmed)}
        </p>
      );
    }
  });

  flushList();
  return <>{elements}</>;
}

// Parse inline markdown (**bold**, *italic*)
function parseInlineMarkdown(text: string): React.ReactNode {
  const parts: React.ReactNode[] = [];
  let current = "";
  let i = 0;

  while (i < text.length) {
    if (text.substring(i, i + 2) === "**") {
      if (current) {
        parts.push(current);
        current = "";
      }
      const end = text.indexOf("**", i + 2);
      if (end !== -1) {
        parts.push(<strong key={i} className="font-bold text-white">{text.substring(i + 2, end)}</strong>);
        i = end + 2;
      } else {
        current += "**";
        i += 2;
      }
    } else if (text[i] === "*" && text[i + 1] !== "*") {
      if (current) {
        parts.push(current);
        current = "";
      }
      const end = text.indexOf("*", i + 1);
      if (end !== -1) {
        parts.push(<em key={i} className="italic">{text.substring(i + 1, end)}</em>);
        i = end + 1;
      } else {
        current += "*";
        i++;
      }
    } else {
      current += text[i];
      i++;
    }
  }

  if (current) {
    parts.push(current);
  }

  return <>{parts}</>;
}

function statusBadgeClass(classification: string) {
  const m: Record<string, string> = {
    Healthy: "badge-healthy", Underfat: "badge-caution",
    Overfat: "badge-warning", Obese: "badge-danger",
  };
  return `inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-semibold ${m[classification] ?? "badge-neutral"}`;
}

export function ResultsPanel({ frame, analysis, diagnostics, csiMeta, inputSource, onRescan }: {
  frame: ScanFrame; analysis: Analysis;
  diagnostics?: ScanDiagnostics;
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
    <div className="space-y-4 animate-[fadeIn_0.25s_ease-out] w-full max-w-7xl mx-auto">
      {/* Report header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-xl font-bold tracking-tight" style={{ color: "var(--color-text-primary)" }}>Scan Report</h2>
          <p className="text-sm mt-1" style={{ color: "var(--color-text-muted)" }}>
            {new Date(frame.timestamp).toLocaleString()} &nbsp;·&nbsp;
            <span style={{ color: analysis.source === "qwen" ? "var(--color-brand)" : "" }}>
              {analysis.source === "qwen" ? "Qwen AI" : "Rule engine"}
            </span>
            &nbsp;·&nbsp;{inputSource}
          </p>
        </div>
        <button onClick={onRescan} className="btn-primary flex items-center gap-2">
          <span className="w-4 h-4"><Icon.Refresh /></span>New Scan
        </button>
      </div>

      {/* CSI Metadata strip */}
      {csiMeta && (
        <div className="rounded-xl px-5 py-4 grid grid-cols-2 gap-4 md:grid-cols-3 2xl:grid-cols-6"
          style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
          {[
            ["Format", csiMeta.format], ["Frames", String(csiMeta.numFrames)],
            ["Duration", `${csiMeta.durationSeconds}s`], ["Rate", `${csiMeta.sampleRateHz} Hz`],
            ["Antennas", String(csiMeta.numAntennas)], ["Subcarriers", String(csiMeta.numSubcarriers)],
          ].map(([k, v]) => (
            <div key={k}>
              <p className="label text-sm">{k}</p>
              <p className="metric mt-1 text-base font-medium" style={{ color: "var(--color-text-primary)" }}>{v}</p>
            </div>
          ))}
        </div>
      )}

      {diagnostics && (
        <div
          className="rounded-xl px-5 py-4 space-y-3"
          style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}
        >
          <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
            <p className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>
              Signal diagnostics
            </p>
            <p className="text-xs" style={{ color: "var(--color-text-muted)" }}>
              Quality {diagnostics.qualityGrade} ({(diagnostics.qualityScore * 100).toFixed(0)}%) ·
              Interference {(diagnostics.interferenceScore * 100).toFixed(0)}%
            </p>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
            <div className="rounded-lg p-3" style={{ background: "var(--color-surface-1)" }}>
              <p style={{ color: "var(--color-text-muted)" }}>Gate status</p>
              <p style={{ color: diagnostics.qualityGatePassed ? "#34d399" : "#f87171" }}>
                {diagnostics.qualityGatePassed ? "passed" : "failed"}
              </p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--color-surface-1)" }}>
              <p style={{ color: "var(--color-text-muted)" }}>Multi-person risk</p>
              <p style={{ color: diagnostics.multiPersonLikely ? "#fbbf24" : "#34d399" }}>
                {diagnostics.multiPersonLikely ? "likely" : "low"}
              </p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--color-surface-1)" }}>
              <p style={{ color: "var(--color-text-muted)" }}>Calibration</p>
              <p style={{ color: "var(--color-text-primary)" }}>
                {diagnostics.calibration.profileId ?? "default"}
              </p>
            </div>
            <div className="rounded-lg p-3" style={{ background: "var(--color-surface-1)" }}>
              <p style={{ color: "var(--color-text-muted)" }}>Fusion nodes</p>
              <p style={{ color: "var(--color-text-primary)" }}>
                {diagnostics.fusion?.nodeCount ?? 1}
              </p>
            </div>
          </div>
          {diagnostics.warnings.length > 0 && (
            <div className="space-y-1">
              {diagnostics.warnings.map((warning) => (
                <p key={warning} className="text-xs" style={{ color: "#fbbf24" }}>
                  - {warning}
                </p>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Main 2-column body */}
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-3">
        {/* Left: 3D Body Viewer + measurement table spans 2 columns on extra large */}
        <div className="flex flex-col xl:col-span-2 rounded-xl overflow-hidden shadow-sm" style={{ border: "1px solid var(--color-border)" }}>
          <Body3DViewer
            keypoints={frame.keypoints}
            keypointSequence={frame.keypointSequence}
            dominantMotionHz={frame.temporal?.dominantMotionHz}
            breathingHz={frame.temporal?.breathingHz}
            minHeight="clamp(500px, 66vh, 920px)"
            bodyMetrics={frame.bodyMetrics}
            bodyFatPercent={analysis.bodyFatPercent}
            classification={analysis.bodyFatClassification}
            measurements={measurements}
          />
          {/* Measurement table */}
          <div style={{ background: "var(--color-surface-2)", borderTop: "1px solid var(--color-border)", padding: "16px 20px" }}>
            <p className="label mb-4 text-sm font-semibold" style={{ color: "var(--color-text-muted)" }}>Body Measurements · SMPL-fit Anthropometric Model</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
              {MEASUREMENT_ORDER.map(({ key, label, isBiacromial }) => (
                <div key={key} className="flex flex-col">
                  <span className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>{label}</span>
                  <span className="metric text-sm mt-1" style={{ color: "var(--color-text-primary)" }}>
                    {measurements[key]} cm
                    {isBiacromial && <span style={{ color: "var(--color-text-muted)", fontSize: "0.6rem", marginLeft: 4 }}>width</span>}
                  </span>
                </div>
              ))}
              <div className="flex flex-col">
                <span className="text-xs uppercase tracking-wide" style={{ color: "var(--color-text-muted)" }}>Height</span>
                <span className="metric text-sm mt-1" style={{ color: "var(--color-text-primary)" }}>{frame.bodyMetrics.estimatedHeightCm} cm</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right column */}
        <div className="grid gap-5 xl:grid-cols-1 md:grid-cols-2 content-start">
          {/* Temporal motion analysis */}
          {frame.temporal && (
            <div className="rounded-xl p-5 space-y-4 shadow-sm"
              style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
              <div className="flex items-center justify-between border-b pb-3" style={{ borderColor: "var(--color-border)" }}>
                <p className="font-semibold text-sm" style={{ color: "var(--color-text-primary)" }}>Motion Replay</p>
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-bold badge-neutral">
                  {frame.temporal.durationSeconds.toFixed(1)}s
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="label">Dominant motion</p>
                  <p className="metric text-lg font-medium mt-1" style={{ color: "var(--color-text-primary)" }}>
                    {frame.temporal.dominantMotionHz.toFixed(2)} Hz
                  </p>
                </div>
                <div>
                  <p className="label">Motion energy</p>
                  <p className="metric text-lg font-medium mt-1" style={{ color: "var(--color-text-primary)" }}>
                    {frame.temporal.motionEnergy.toFixed(3)}
                  </p>
                </div>
                <div>
                  <p className="label">Phase stability</p>
                  <p className="metric text-lg font-medium mt-1" style={{ color: "var(--color-text-primary)" }}>
                    {(frame.temporal.phaseStability * 100).toFixed(0)}%
                  </p>
                </div>
                <div>
                  <p className="label">Frames</p>
                  <p className="metric text-lg font-medium mt-1" style={{ color: "var(--color-text-primary)" }}>
                    {frame.temporal.sequenceLength}
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Body composition */}
          <div className="rounded-xl p-5 space-y-4 shadow-sm"
            style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            <div className="flex items-center justify-between">
              <p className="font-semibold text-sm" style={{ color: "var(--color-text-primary)" }}>Body Composition</p>
              <span className={statusBadgeClass(analysis.bodyFatClassification)}>
                <Icon.Circle filled />
                {analysis.bodyFatClassification}
              </span>
            </div>
            <div className="flex items-end gap-2 mt-2">
              <p className="metric text-6xl font-semibold" style={{ color: "var(--color-text-primary)", letterSpacing: "-0.02em" }}>{fatPct}</p>
              <p className="text-lg mb-1.5 font-medium" style={{ color: "var(--color-text-muted)" }}>%</p>
            </div>
            <ProgressBar value={fatPct} max={45} colorClass={fatBarColor} />
            <div className="flex justify-between text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>
              <span>5%</span><span>Underfat·Healthy·Overfat·Obese</span><span>45%</span>
            </div>

            <div className="grid grid-cols-2 gap-4 pt-4 mt-2 border-t" style={{ borderColor: "var(--color-border)" }}>
              <StatBlock label="Est. Waist" value={analysis.estimatedWaistCm} unit="cm" />
              <StatBlock label="Torso" value={frame.bodyMetrics.torsoLengthCm} unit="cm" />
            </div>
          </div>

          {/* Vitals */}
          <div className="rounded-xl p-5 shadow-sm"
            style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            <p className="font-semibold text-sm mb-4" style={{ color: "var(--color-text-primary)" }}>Extracted Vitals</p>
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-1)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-4 h-4 text-red-400"><Icon.Heart /></span>
                  <p className="text-xs uppercase font-medium tracking-wide text-red-500/80">HR</p>
                </div>
                <p className="metric text-2xl text-red-400">{frame.vitals.heartRate}<span className="text-xs text-slate-500 font-normal ml-0.5">bpm</span></p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-1)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-4 h-4 text-cyan-400"><Icon.Lung /></span>
                  <p className="text-xs uppercase font-medium tracking-wide text-cyan-500/80">Resp</p>
                </div>
                <p className="metric text-2xl text-cyan-400">{frame.vitals.breathingRate}<span className="text-xs text-slate-500 font-normal ml-0.5">rpm</span></p>
              </div>
              <div className="p-3 rounded-lg" style={{ background: "var(--color-surface-1)" }}>
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-4 h-4 text-violet-400"><Icon.Cpu /></span>
                  <p className="text-xs uppercase font-medium tracking-wide text-violet-500/80">HRV</p>
                </div>
                <p className="metric text-2xl text-violet-400">{frame.vitals.hrv}<span className="text-xs text-slate-500 font-normal ml-0.5">ms</span></p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Clinical Summary */}
      <div className="rounded-xl p-6 space-y-4 shadow-sm"
        style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)", borderLeft: "4px solid var(--color-brand)" }}>
        <div className="flex items-center justify-between">
          <p className="text-lg font-bold" style={{ color: "var(--color-text-primary)" }}>Clinical Summary</p>
          {analysis.source === "qwen" && (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-bold badge-neutral bg-blue-500/10 text-blue-400 border border-blue-500/20">
              Qwen-Plus · AI
            </span>
          )}
        </div>
        <div className="text-base leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>
          {analysis.clinicalSummary ? parseMarkdown(analysis.clinicalSummary) : null}
        </div>
      </div>

      {/* Posture note */}
      {analysis.postureNotes && (
        <div className="rounded-xl px-5 py-4 flex gap-4 items-start shadow-sm"
          style={{ background: "rgba(245,158,11,0.05)", border: "1px solid rgba(245,158,11,0.3)" }}>
          <span className="text-yellow-500 mt-0.5 flex-shrink-0 text-lg">⚑</span>
          <div>
            <p className="text-sm font-bold text-yellow-500 mb-1">Posture Anomaly Detected</p>
            <p className="text-sm leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{analysis.postureNotes}</p>
          </div>
        </div>
      )}

      {/* ── Chat with AI ── */}
      <div className="rounded-xl overflow-hidden flex flex-col shadow-sm"
        style={{ border: "1px solid var(--color-border)", background: "var(--color-surface-1)", minHeight: 600 }}>
        <ChatWithAI
          scanMetrics={{
            heartRateBpm:          frame.vitals.heartRate,
            breathingRateBpm:      frame.vitals.breathingRate,
            hrv:                   frame.vitals.hrv,
            bodyFatPercent:        analysis.bodyFatPercent,
            bodyFatClassification: analysis.bodyFatClassification,
            estimatedHeightCm:     frame.bodyMetrics.estimatedHeightCm,
            shoulderWidthCm:       frame.bodyMetrics.shoulderWidthCm,
            hipWidthCm:            frame.bodyMetrics.hipWidthCm,
            clinicalSummary:       analysis.clinicalSummary,
          }}
        />
      </div>

      {/* ── How It Works — collapsible pipeline explainer ── */}
      <HowItWorksPanelWrapper />

      {inputSource === "image" ? (
        <p className="text-center text-xs pb-4 pt-4" style={{ color: "var(--color-text-muted)" }}>
          <span className="w-3 h-3 inline-block mr-1"><Icon.Image /></span>
          2D Image Anthropometric Estimation. Visual data processed via AI modeling.
        </p>
      ) : (
        <p className="text-center text-xs pb-4 pt-4" style={{ color: "var(--color-text-muted)" }}>
          <span className="w-3 h-3 inline-block mr-1"><Icon.Lock /></span>
          No camera. No biometric storage. WiFi RF analysis only.
        </p>
      )}
    </div>
  );
}

function HowItWorksPanelWrapper() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl overflow-hidden shadow-sm mt-4" style={{ border: "1px solid var(--color-border)" }}>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left transition-colors hover:bg-slate-800/50"
        style={{ background: "var(--color-surface-2)", border: "none", cursor: "pointer" }}
      >
        <div className="flex items-center gap-3">
          <svg viewBox="0 0 24 24" fill="none" stroke="#22d3ee" strokeWidth={2}
            style={{ width: 18, height: 18, flexShrink: 0 }}>
            <path strokeLinecap="round" strokeLinejoin="round"
              d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 01-6.23-.607L5 14.5m14.8.5l.391 1.561a2.25 2.25 0 01-2.185 2.814H6.001a2.25 2.25 0 01-2.185-2.814L4.198 15" />
          </svg>
          <span className="text-base font-semibold" style={{ color: "var(--color-text-primary)" }}>
            How WALLNUT Works — Pipeline Explainer
          </span>
          <span className="text-xs px-2.5 py-0.5 rounded font-bold uppercase tracking-wider ml-2" style={{
            background: "#22d3ee12", color: "#22d3ee", border: "1px solid #22d3ee30"
          }}>5 Stages</span>
        </div>
        <span style={{
          color: "#4a8fa8", fontSize: "1rem",
          transform: open ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "inline-block",
        }}>▾</span>
      </button>
      {open && (
        <div className="p-6 border-t" style={{ background: "var(--color-surface-1)", borderColor: "var(--color-border)" }}>
          <HowItWorks />
        </div>
      )}
    </div>
  );
}
