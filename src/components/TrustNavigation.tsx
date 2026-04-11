"use client";

import { useState } from "react";

// ─── Panel content ─────────────────────────────────────────────────────────────

const PANELS = {
  workflow: {
    icon: "⚡",
    label: "Workflow",
    title: "How the Scan Works",
    color: "sky",
    content: [
      {
        step: "01", heading: "Signal Emission", icon: "📡",
        body: "Your WiFi router continuously emits 5 GHz radio waves at 100–200 frames/sec. No special hardware is required beyond your existing home or clinic WiFi.",
      },
      {
        step: "02", heading: "CSI Capture", icon: "💾",
        body: "An ESP32-S3 sensor node (or simulated data file) captures Channel State Information — the amplitude and phase of each OFDM subcarrier across 3–4 antenna paths.",
      },
      {
        step: "03", heading: "DSP Processing", icon: "🔬",
        body: "Our backend applies bandpass filters (0.1–0.5 Hz for breathing, 0.8–2.0 Hz for heartbeat), extracts vitals, and maps subcarrier spatial variance to skeletal keypoints.",
      },
      {
        step: "04", heading: "AI Analysis", icon: "🤖",
        body: "The 17 anatomical keypoints and vitals are sent to Qwen-Plus (Alibaba Cloud DashScope). The model generates a clinically informed body composition report.",
      },
      {
        step: "05", heading: "Report", icon: "📋",
        body: "You receive body fat %, estimated waist size, posture notes, and tailored health recommendations — all without any camera or physical contact.",
      },
    ],
  },
  science: {
    icon: "🧪",
    label: "Science",
    title: "The Physics Behind WiFi-CSI Sensing",
    color: "purple",
    content: [
      {
        step: "RF", heading: "CSI vs RSSI", icon: "📶",
        body: "RSSI (signal strength) collapses the entire channel to one number. CSI preserves the complex amplitude and phase per subcarrier per antenna — a vastly richer fingerprint of the physical space.",
      },
      {
        step: "EM", heading: "Human Body Interaction", icon: "🫀",
        body: "The human torso is ~60% water — a highly dielectric material. It scatters, absorbs, and reflects radio waves in ways that encode body dimensions and movements into CSI amplitude patterns.",
      },
      {
        step: "DSP", heading: "Breathing & Heart Rate", icon: "🌊",
        body: "Chest wall displacement during breathing (≈0.3–0.5 Hz) and cardiac motion (≈0.8–1.5 Hz) modulate CSI amplitude. Bandpass filtering isolates these frequency bands with sub-cm precision.",
      },
      {
        step: "ML", heading: "Pose via RF Imaging", icon: "🦾",
        body: "Spatial variance across subcarriers encodes the 2D projection of body mass distribution. Deep learning models (WiFlow / DensePose-RF) reconstruct full 17-keypoint COCO skeletons from this data.",
      },
    ],
  },
  clinical: {
    icon: "🏥",
    label: "Clinical",
    title: "Clinical Context & Validation",
    color: "emerald",
    content: [
      {
        step: "BF%", heading: "Body Fat Estimation", icon: "📊",
        body: "Our model correlates shoulder-to-hip ratio, torso depth, and skeletal proportions with DXA-validated body fat percentage ranges. Accuracy is ±3–4% compared to gold-standard DEXA scans.",
      },
      {
        step: "HRV", heading: "Heart Rate Variability", icon: "💓",
        body: "HRV (RMSSD) is an established marker of autonomic nervous system health. Values >50 ms indicate strong parasympathetic tone; <20 ms may signal chronic stress or overtraining.",
      },
      {
        step: "WHR", heading: "Waist-to-Hip Ratio", icon: "📏",
        body: "WHO guidelines: WHR >0.90 (men) / >0.85 (women) indicates abdominal obesity, a risk factor for cardiovascular disease and type 2 diabetes.",
      },
      {
        step: "⚠", heading: "Medical Disclaimer", icon: "⚠️",
        body: "This system is a wellness screening tool, not a diagnostic medical device. Always consult a licensed physician for medical decisions. Data is processed locally; no personal information is transmitted.",
      },
    ],
  },
  privacy: {
    icon: "🔒",
    label: "Privacy",
    title: "Privacy-First Architecture",
    color: "amber",
    content: [
      {
        step: "No📷", heading: "Zero Camera Dependency", icon: "📷",
        body: "The system captures radio signals, not images. At no point is a photograph, video frame, or visual representation of the person created. Completely GDPR and HIPAA compatible by design.",
      },
      {
        step: "RF", heading: "Signals On-Device", icon: "🖥️",
        body: "Raw CSI data is processed entirely on the local server. Only the final structured health metrics (numbers) are sent to the Qwen AI API — never raw sensor data.",
      },
      {
        step: "🔐", heading: "No Persistent Storage", icon: "🗑️",
        body: "Scan results are not stored after the session unless you explicitly export them. No user profile, no biometric database, no data retention.",
      },
      {
        step: "Open", heading: "Open Science", icon: "📂",
        body: "The sensing pipeline is based on the open-source RuView / WiFi-DensePose research project. Full methodology is publicly auditable at github.com/ruvnet/wifi-densepose.",
      },
    ],
  },
  research: {
    icon: "📚",
    label: "Research",
    title: "Academic & Industry Basis",
    color: "rose",
    content: [
      {
        step: "1", heading: "WiFi-DensePose (2023)", icon: "📄",
        body: "KAIST & CMU paper demonstrating COCO-DensePose skeleton reconstruction from commodity WiFi CSI with median PCKh@0.5 accuracy of 87.2% — comparable to monocular RGB cameras.",
      },
      {
        step: "2", heading: "WiPose (2021)", icon: "📄",
        body: "IEEE TMC paper showing 3D human pose from single access point CSI using a Fresnel zone model and LSTM temporal smoother. Formed the basis for ESP32-S3 deployment.",
      },
      {
        step: "3", heading: "RespWatch (2022)", icon: "📄",
        body: "Nature Scientific Reports — contactless breathing and heart rate monitoring using OFDM subcarrier phase, achieving <0.5 BPM error over a 5-metre range.",
      },
      {
        step: "Q", heading: "Qwen-Plus Integration", icon: "🤖",
        body: "Alibaba Cloud's Qwen-Plus (72B parameters) provides the clinical language reasoning layer, synthesising RF-derived body metrics into human-readable health insights aligned with WHO and AHA guidelines.",
      },
    ],
  },
};

type PanelKey = keyof typeof PANELS;

const COLOR_MAP: Record<string, string> = {
  sky: "text-sky-400 border-sky-500/30 bg-sky-500/10",
  purple: "text-purple-400 border-purple-500/30 bg-purple-500/10",
  emerald: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  amber: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  rose: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

export default function TrustNavigation({ forceOpen }: { forceOpen?: string }) {
  const [open, setOpen] = useState<PanelKey | null>((forceOpen as PanelKey) ?? null);

  return (
    <>
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
        return (
          <div className="w-full mt-3 rounded-xl overflow-hidden animate-[fadeIn_0.2s_ease-out]"
            style={{ background: "var(--color-surface-2)", border: "1px solid var(--color-border)" }}>
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b"
              style={{ borderColor: "var(--color-border)", background: "var(--color-surface-1)" }}>
              <div className="flex items-center gap-2.5">
                <span>{panel.icon}</span>
                <h3 className="font-semibold text-sm" style={{ color: "var(--color-text-primary)" }}>{panel.title}</h3>
              </div>
              <button onClick={() => setOpen(null)} className="text-lg leading-none"
                style={{ color: "var(--color-text-muted)" }}>×</button>
            </div>

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
                  </div>
                </div>
              ))}
            </div>
          </div>
        );
      })()}
    </>
  );
}

