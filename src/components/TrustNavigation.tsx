"use client";

import { useState } from "react";

type PanelColor = "sky" | "purple" | "emerald" | "amber" | "rose";

interface PanelStep {
  step: string;
  heading: string;
  icon: string;
  body: string;
  detail?: string;
}

interface PanelFlowNode {
  label: string;
  note: string;
}

interface PanelReference {
  title: string;
  href: string;
  detail: string;
}

interface Panel {
  icon: string;
  label: string;
  title: string;
  objective: string;
  color: PanelColor;
  flow?: PanelFlowNode[];
  content: PanelStep[];
  references?: PanelReference[];
}

// ─── Panel content ─────────────────────────────────────────────────────────────

const PANELS: Record<"workflow" | "logic" | "clinical" | "research" | "privacy", Panel> = {
  workflow: {
    icon: "⚡",
    label: "Workflow",
    title: "End-to-End CSI Workflow",
    objective: "RF sensing pipeline with mechanical and DSP terms from capture to clinical summary.",
    color: "sky",
    flow: [
      { label: "RF propagation", note: "OFDM subcarriers + multipath scattering" },
      { label: "CSI capture", note: "A(f,t) and optional phase phi(f,t)" },
      { label: "Signal conditioning", note: "Mean-centering + IIR band-pass windows" },
      { label: "Breathing channel", note: "0.1-0.5 Hz + zero-crossing RPM" },
      { label: "Cardiac channel", note: "0.8-2.0 Hz + zero-crossing BPM + HRV" },
      { label: "Pose inference", note: "Subcarrier zones -> 17 COCO keypoints" },
      { label: "Temporal inference", note: "DFT dominant frequency + motion dynamics" },
      { label: "Clinical synthesis", note: "Anthropometrics + Qwen/fallback JSON" },
    ],
    content: [
      {
        step: "01",
        heading: "RF mechanics and sensing medium",
        icon: "📥",
        body: "Human chest and torso micro-motion perturb OFDM multipath channels. In channel terms, the received response H(f,t) changes in amplitude and phase as body posture and respiration evolve.",
        detail: "Terminology: OFDM, subcarriers, multipath fading, dielectric scattering.",
      },
      {
        step: "02",
        heading: "Input unification and modality routing",
        icon: "🧩",
        body: "Service handlers split by modality: WiFi CSI (JSONL/proof streams) vs Visual Media (Multipart Base64 Forms). The pipeline normalizes non-uniform telemetry into consistent inference matrices prior to analytical logic.",
        detail: "Handlers: `/api/scan/upload` vs `/api/scan/image`. Both resolve to identical clinical metrics.",
      },
      {
        step: "03",
        heading: "Breathing extraction (respiratory band)",
        icon: "💓",
        body: "Amplitude time-series is mean-centered, then filtered with a 0.1-0.5 Hz band-pass to isolate respiratory components caused by chest wall displacement.",
        detail: "Breathing RPM is derived by zero-crossing rate in `extractVitals`.",
      },
      {
        step: "04",
        heading: "Heart-rate and HRV extraction (cardiac band)",
        icon: "🧍",
        body: "A second band-pass (0.8-2.0 Hz) isolates cardiac micro-motion. Zero-crossing estimates BPM, while peak intervals are used to compute RMSSD-style HRV.",
        detail: "Functions: `zeroCrossingRate`, `findPeaks`, `calculateHRV`.",
      },
      {
        step: "05",
        heading: "Spatial pose reconstruction",
        icon: "📏",
        body: "Normalized subcarrier energy is partitioned into body zones (head, shoulders, torso, hips, thighs, calves) and projected into 17 COCO keypoints.",
        detail: "Function: `estimatePoseFromCSI` with `buildKeypointsFromProportions`.",
      },
      {
        step: "06",
        heading: "Temporal motion inference",
        icon: "🤖",
        body: "Sliding-window features estimate dominant motion frequency (small DFT scan), motion energy, and phase stability to describe motion dynamics without forcing fixed posture/action labels.",
        detail: "Function: `analyzeTemporalPose`.",
      },
      {
        step: "07",
        heading: "Anthropometrics and plausibility gate",
        icon: "✅",
        body: "Keypoint geometry is transformed into shoulder/hip/torso/limb measurements, then constrained by anatomical ranges to prevent unrealistic oversized simulated outputs.",
        detail: "Functions: `computeBodyMetrics`, `stabilizeBodyMetrics`, `estimateCircumferences`.",
      },
      {
        step: "08",
        heading: "Clinical synthesis & Deurenberg Fallbacks",
        icon: "🧾",
        body: "Metrics map to DashScope's Multimodal systems. If network limits are reached, the system diverges strictly into deterministic algebraic bounds—deriving body mass compositions via Deurenberg's univariate modifications mapping BMI scalar relationships.",
        detail: "Functions: `buildPrompt`, `qwen-vl-max` vision binding, plus pure math approximation: BF% = (1.20 * BMI) - 2.5.",
      },
    ],
    references: [
      {
        title: "RuView README: CSI bands and keypoint pipeline",
        href: "https://github.com/ruvnet/RuView",
        detail: "Documents 0.1-0.5 Hz breathing, 0.8-2.0 Hz heart-rate, and 17-keypoint CSI pose mapping.",
      },
      {
        title: "DensePose From WiFi (arXiv:2301.00250)",
        href: "https://arxiv.org/abs/2301.00250",
        detail: "Research basis for mapping WiFi amplitude/phase to dense pose information.",
      },
      {
        title: "Channel State Information (CSI) concept",
        href: "https://en.wikipedia.org/wiki/Channel_state_information",
        detail: "Background on channel response modeling and propagation effects.",
      },
      {
        title: "Band-pass filtering fundamentals",
        href: "https://en.wikipedia.org/wiki/Band-pass_filter",
        detail: "Reference for passband/stopband behavior used in respiratory and cardiac extraction.",
      },
    ],
  },
  logic: {
    icon: "🧠",
    label: "Logic",
    title: "Decision Logic and Safety Rails",
    objective: "How the system handles uncertainty, fallbacks, and output consistency.",
    color: "purple",
    flow: [
      { label: "Validate", note: "Reject missing/invalid telemetry or broken media" },
      { label: "Score", note: "Compute confidence via hardware phase stability bounds" },
      { label: "Branch", note: "Route to Qwen-VL-Max Vision or Qwen-Plus Text" },
      { label: "Fallback", note: "Mathematical Regression (Deurenberg approximations)" },
      { label: "Normalize", note: "Return rigid clinical API Schema JSON" },
    ],
    content: [
      {
        step: "G1",
        heading: "Input gates",
        icon: "🚧",
        body: "Missing file and parse errors are surfaced as explicit API errors (400/422), not silent failures.",
      },
      {
        step: "G2",
        heading: "Signal quality aware confidence",
        icon: "📈",
        body: "Temporal confidence combines phase stability and motion score so downstream logic reflects signal reliability.",
      },
      {
        step: "G3",
        heading: "Structured AI contract",
        icon: "📐",
        body: "Qwen is prompted for strict JSON schema output to keep frontend rendering deterministic.",
      },
      {
        step: "G4",
        heading: "Deterministic algebraic fallback",
        icon: "🛟",
        body: "In the absence of functional APIs, equations derive outputs using mathematical proxies. Image anthropometry translates dimensions algorithmically via calculated Waist projections: Waist = Height * (0.42 + (BF% - 15) * 0.005).",
      },
      {
        step: "G5",
        heading: "Traceable output source",
        icon: "🏷️",
        body: "Each analysis includes `source: qwen | rule-based`, making interpretation and debugging transparent.",
      },
    ],
  },
  clinical: {
    icon: "🏥",
    label: "Clinical",
    title: "Clinical Usage Workflow",
    objective: "A practical clinic-facing sequence for using the scan output responsibly.",
    color: "emerald",
    flow: [
      { label: "Baseline", note: "Capture first scan with context notes" },
      { label: "Compare", note: "Track trends across repeated scans" },
      { label: "Triage", note: "Flag elevated risk patterns" },
      { label: "Escalate", note: "Route to clinician when needed" },
      { label: "Follow-up", note: "Re-scan after intervention" },
    ],
    content: [
      {
        step: "C1",
        heading: "Baseline assessment",
        icon: "🧾",
        body: "Start with one baseline scan to capture vitals, body-fat class, and posture profile in a stable environment.",
      },
      {
        step: "C2",
        heading: "Trend-first interpretation",
        icon: "📊",
        body: "Use repeated measurements to identify directional change (improving, stable, worsening), not one-off diagnosis.",
      },
      {
        step: "C3",
        heading: "Risk triage cues",
        icon: "⚠️",
        body: "Elevated heart rate, low HRV trends, and worsening body-fat class should trigger clinician review.",
      },
      {
        step: "C4",
        heading: "Intervention loop",
        icon: "🔁",
        body: "Pair recommendations (breathing practice, lifestyle, recovery habits) with scheduled follow-up scans to quantify response.",
      },
      {
        step: "C5",
        heading: "Scope boundary",
        icon: "🩺",
        body: "This is a wellness screening assistant, not a standalone medical diagnosis tool.",
      },
    ],
  },
  research: {
    icon: "📚",
    label: "Research",
    title: "Evidence and Technical Foundation",
    objective: "How this implementation maps to published WiFi sensing research and RuView architecture.",
    color: "rose",
    content: [
      {
        step: "R1",
        heading: "Dense pose from WiFi",
        icon: "📄",
        body: "CMU work shows phase + amplitude can map to dense human pose regions, supporting camera-free sensing pipelines.",
      },
      {
        step: "R2",
        heading: "RuView implementation lineage",
        icon: "🧬",
        body: "RuView documents CSI-based vitals, temporal motion inference, and 17-keypoint pose pipelines that this app adapts.",
      },
      {
        step: "R3",
        heading: "Commodity hardware focus",
        icon: "📡",
        body: "The solution emphasizes low-cost ESP32 and standard WiFi infrastructure for practical deployment.",
      },
      {
        step: "R4",
        heading: "Known limitations",
        icon: "🔍",
        body: "Accuracy remains environment-sensitive; robust deployment needs calibration, trend monitoring, and transparent confidence cues.",
      },
    ],
    references: [
      {
        title: "DensePose From WiFi (arXiv:2301.00250)",
        href: "https://arxiv.org/abs/2301.00250",
        detail: "Primary research on dense correspondence from WiFi CSI.",
      },
      {
        title: "CMU RI publication page",
        href: "https://www.ri.cmu.edu/publications/dense-human-pose-estimation-from-wifi/",
        detail: "Summary of motivation, method, and privacy implications.",
      },
      {
        title: "RuView project documentation",
        href: "https://github.com/ruvnet/RuView",
        detail: "Open-source reference implementation and architecture.",
      },
    ],
  },
  privacy: {
    icon: "🔒",
    label: "Privacy",
    title: "Privacy and Data Boundaries",
    objective: "What the system sees, what it sends, and what it does not retain by default.",
    color: "amber",
    content: [
      {
        step: "P1",
        heading: "Strict ephemeral image handling",
        icon: "🚫📷",
        body: "When utilizing the Vision AI pipeline, media is transmitted purely in ephemeral volatile memory arrays. Inference is calculated synchronously, destroying the base64 media matrix instantly upon DashScope network closure.",
      },
      {
        step: "P2",
        heading: "Local signal processing",
        icon: "🖥️",
        body: "CSI parsing, filtering, and pose inference run locally before high-level metrics are summarized.",
      },
      {
        step: "P3",
        heading: "Controlled external payload",
        icon: "📤",
        body: "Only structured derived metrics are sent to Qwen for language synthesis; raw CSI matrices stay local.",
      },
      {
        step: "P4",
        heading: "Session-oriented usage",
        icon: "🧹",
        body: "Default usage focuses on immediate interpretation rather than long-term personal biometric storage.",
      },
    ],
  },
};

type PanelKey = keyof typeof PANELS;

const COLOR_MAP: Record<PanelColor, string> = {
  sky: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  purple: "text-purple-400 border-purple-500/30 bg-purple-500/10",
  emerald: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  amber: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  rose: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

export default function TrustNavigation({ forceOpen }: { forceOpen?: PanelKey }) {
  const [open, setOpen] = useState<PanelKey | null>(forceOpen ?? "workflow");

  return (
    <section className="space-y-3">
      {/* Trust Nav Bar */}
      <nav className="flex items-center gap-1 flex-wrap">
        {(Object.keys(PANELS) as PanelKey[]).map((key) => {
          const p = PANELS[key];
          const isActive = open === key;
          return (
            <button
              key={key}
              onClick={() => setOpen(isActive ? null : key)}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer"
              style={{
                background: isActive ? "rgba(34,211,238,0.08)" : "transparent",
                border: isActive ? "1px solid rgba(34,211,238,0.25)" : "1px solid var(--color-border)",
                color: isActive ? "var(--color-brand)" : "var(--color-text-muted)",
              }}
            >
              <span>{p.icon}</span>
              <span>{p.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Panel Drawer */}
      {open && (() => {
        const panel = PANELS[open];
        const colorClass = COLOR_MAP[panel.color] ?? COLOR_MAP.sky;
        const flowNodes = panel.flow ?? [];
        return (
          <div className="w-full mt-3 rounded-xl overflow-hidden animate-[fadeIn_0.2s_ease-out]"
            style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            {/* Header */}
            <div className="flex items-start justify-between px-4 py-3 border-b gap-4"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface-1)" }}>
              <div className="flex items-center gap-2.5">
                <span className="mt-0.5">{panel.icon}</span>
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: "var(--color-text-primary)" }}>{panel.title}</h3>
                  <p className="text-xs mt-1" style={{ color: "var(--color-text-muted)" }}>{panel.objective}</p>
                </div>
              </div>
              <button onClick={() => setOpen(null)} className="text-lg leading-none"
                style={{ color: "var(--color-text-muted)" }}>×</button>
            </div>

            {/* Flow diagram */}
            {flowNodes.length > 0 && (
              <div className="px-4 py-3 border-b" style={{ borderColor: "var(--color-border)" }}>
                <p className="text-[11px] uppercase tracking-wide mb-2" style={{ color: "var(--color-text-muted)" }}>
                  Workflow diagram
                </p>
                <div className="flex flex-wrap items-stretch gap-1.5">
                  {flowNodes.map((node, idx) => (
                    <div key={`${node.label}-${idx}`} className="flex items-center gap-1.5">
                      <div className={`rounded-md border px-2 py-1.5 min-w-[130px] ${colorClass}`}>
                        <p className="text-[11px] font-semibold leading-tight">{idx + 1}. {node.label}</p>
                        <p className="text-[11px] leading-tight mt-0.5 opacity-90">{node.note}</p>
                      </div>
                      {idx < flowNodes.length - 1 && (
                        <span className="text-xs" style={{ color: "var(--color-text-muted)" }}>→</span>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Steps */}
            <div>
              {panel.content.map((item, idx) => (
                <div key={item.step} className="flex gap-4 px-4 py-3.5"
                  style={{ borderBottom: idx < panel.content.length - 1 ? `1px solid var(--color-border)` : "none" }}>
                  <div className="flex-shrink-0 mt-0.5">
                    <div className={`text-xs font-bold px-1.5 py-0.5 rounded border ${colorClass} tabular-nums min-w-[2rem] text-center`}>
                      {item.step}
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-sm">{item.icon}</span>
                      <span className="text-sm font-semibold" style={{ color: "var(--color-text-primary)" }}>{item.heading}</span>
                    </div>
                    <p className="text-xs leading-relaxed" style={{ color: "var(--color-text-secondary)" }}>{item.body}</p>
                    {item.detail && (
                      <p className="text-[11px] mt-1.5 leading-relaxed" style={{ color: "var(--color-text-muted)" }}>
                        {item.detail}
                      </p>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {panel.references && panel.references.length > 0 && (
              <div className="px-4 py-3 border-t" style={{ borderColor: "var(--color-border)", background: "var(--color-surface-1)" }}>
                <p className="text-xs font-semibold" style={{ color: "var(--color-text-primary)" }}>Sources</p>
                <div className="mt-2 space-y-1.5">
                  {panel.references.map((ref) => (
                    <a
                      key={ref.href}
                      href={ref.href}
                      target="_blank"
                      rel="noreferrer"
                      className="block rounded-md px-2 py-1.5 text-xs hover:bg-white/5 transition-colors"
                      style={{ border: "1px solid var(--color-border)", color: "var(--color-text-secondary)" }}
                    >
                      <p className="font-medium" style={{ color: "var(--color-text-primary)" }}>{ref.title}</p>
                      <p className="mt-0.5">{ref.detail}</p>
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      })()}
    </section>
  );
}
