"use client";
import { useState } from "react";

// ─── Pipeline stage data ──────────────────────────────────────────────────────
const STAGES = [
  {
    id: "ingestion",
    number: "01",
    title: "Signal Ingestion & Formatting",
    subtitle: "OFDM · IQ Decoding · CSI Matrix",
    color: "#22d3ee",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M8.288 15.038a5.25 5.25 0 017.424 0M5.106 11.856c3.807-3.808 9.98-3.808 13.788 0M1.924 8.674c5.565-5.565 14.587-5.565 20.152 0M12.53 18.22l-.53.53-.53-.53a.75.75 0 011.06 0z" />
      </svg>
    ),
    badges: ["802.11n/ac WiFi", "56 OFDM Subcarriers", "IQ Hex Decode", "ESP32-S3"],
    summary: "The ESP32-S3 radio continuously taps the Channel State Information (CSI) from every WiFi packet. The 5 GHz channel is divided into 56 orthogonal subcarrier frequencies — each one a separate measurement channel. Every time a packet is transmitted, the receiver captures the complex amplitude and phase of each subcarrier, encoding them as I/Q byte pairs.",
    technical: [
      {
        label: "Format A — Live Hardware (.csi.jsonl)",
        detail: "Each JSONL line contains a timestamp (nanosecond precision), node_id, RSSI (dBm), and either a pre-decoded amplitudes[] array or raw iq_hex bytes. IQ hex is decoded as: A = √(I² + Q²) for each 2-byte pair (two's-complement signed 8-bit integers).",
      },
      {
        label: "Format B — Deterministic Proof Bundle",
        detail: "A structured JSON containing pre-computed amplitude[antenna][subcarrier] and phase[antenna][subcarrier] matrices, with circular-mean aggregation across antenna elements. Used for simulation and testing without hardware.",
      },
      {
        label: "Unified ParsedCSI Output",
        detail: "Regardless of format: amplitudeMatrix[t][s] (per-frame per-subcarrier grid), subcarrierProfile[s] (time-averaged fingerprint), rssiTimeseries[t] (signal strength), and an estimated sampleRateHz.",
      },
    ],
  },
  {
    id: "dsp",
    number: "02",
    title: "DSP & Vitals Extraction",
    subtitle: "IIR Bandpass · Zero-Crossing · RMSSD",
    color: "#a78bfa",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z" />
      </svg>
    ),
    badges: ["0.1–0.5 Hz Breathing", "0.8–2.0 Hz Cardiac", "RMSSD HRV", "2nd-Order IIR"],
    summary: "The CSI amplitude timeseries encodes the body's mechanical oscillations. The diaphragm modulates the RF channel at breathing frequency (0.1–0.5 Hz); ventricular ejection creates a subtler cardiac micro-signal (0.8–2.0 Hz). Two parallel IIR bandpass filters isolate each component.",
    technical: [
      {
        label: "DC Removal (Mean Centering)",
        detail: "Static environmental reflections create a large DC offset. Subtracting the temporal mean isolates purely dynamic modulation: centered[t] = amplitude[t] − mean(amplitude).",
      },
      {
        label: "2nd-Order IIR Bandpass Filter",
        detail: "H(z) = (b₀ + b₂z⁻²) / (1 + a₁z⁻¹ + a₂z⁻²), where α = sin(πΔω), b₀ = α/2a₀, a₁ = -2cos(2πω₀)/a₀. Two parallel banks: Respiratory [0.1–0.5 Hz] and Cardiac [0.8–2.0 Hz].",
      },
      {
        label: "RMSSD Heart Rate Variability",
        detail: "Peaks in the cardiac-filtered signal mark R-waves. RR intervals give successive differences: RMSSD = √(Σ(RR[i+1]−RR[i])² / N). Clinical range 20–50 ms = healthy parasympathetic tone.",
      },
    ],
  },
  {
    id: "spatial",
    number: "03",
    title: "Spatial Anchor Mapping",
    subtitle: "Subcarrier Zones · COCO 17-Keypoints",
    color: "#34d399",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
      </svg>
    ),
    badges: ["6 Anatomical Zones", "COCO 17 Keypoints", "Subcarrier Energy", "Body Width Proxy"],
    summary: "Different subcarrier frequencies respond to different depths of body tissue due to wavelength-dependent diffraction and reflection. The time-averaged subcarrier energy profile is partitioned into 6 anatomical zones — from head (high-frequency subcarriers) to calves (low-frequency) — enabling estimation of biacromial width, hip width, and torso length.",
    technical: [
      {
        label: "Frequency-Anatomy Correspondence",
        detail: "Subcarriers 0–10%: head (cranial shadow). 10–25%: shoulders (acromion). 25–50%: torso mass. 50–65%: hips (pelvic). 65–80%: thighs. 80–100%: calves/ankles. Lower subcarriers = longer wavelength = diffracts around limbs; higher = reflects off surface.",
      },
      {
        label: "Width Proxy Derivation",
        detail: "shoulderWidthProxy = 0.30 + zones.shoulders × 0.15; hipWidthProxy = 0.25 + zones.hips × 0.12. These normalized values anchor a canonical COCO-17 pose from which actual cm dimensions are computed via reference height.",
      },
      {
        label: "Resolution Limit",
        detail: "At 5 GHz, WiFi wavelength ≈ 6 cm. Rayleigh resolution limit ≈ λ/2 = 3 cm. Sub-centimetre features (finger joints, facial landmarks) cannot be resolved from a single AP. All fine-grained estimates are statistical priors.",
      },
    ],
  },
  {
    id: "kinematics",
    number: "04",
    title: "Temporal Kinematics & Activity Classification",
    subtitle: "Sliding-Window DFT · Phase Stability · Activity Engine",
    color: "#fb923c",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 1.5l-.5-1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
      </svg>
    ),
    badges: ["Sliding Window DFT", "dominantMotionHz", "Phase Stability Score", "4-State Classifier"],
    summary: "A sliding 1.0-second window runs a DFT scan over the centered amplitude timeseries to extract the dominant motion frequency at each time step. Combined with global motion energy and inter-frame phase stability, a deterministic rule engine classifies the subject into Walking, Sitting, Standing, or Fallen — each with a calibrated confidence score.",
    technical: [
      {
        label: "Activity Classification Thresholds",
        detail: "Walking: dominantMotionHz > 0.85 AND motionEnergy > 0.06 → stride cadence + bilateral arm swing. Fallen: Hz < 0.25 AND energy < 0.045 AND meanAmp < 42 dB → horizontal body reorientation. Sitting: Hz 0.15–0.60, energy < 0.06 → capped-respiration only. Standing: energy < 0.08 → vestibular micro-sway.",
      },
      {
        label: "Phase Stability Score",
        detail: "phaseStability = clamp(1 − meanAbsCircularDiff / π, 0.35, 1.0). High stability = quasi-static (sitting/standing). Low stability = fast movement or RF interference. Influences per-frame confidence: C = 0.55 + 0.22·phaseStability + 0.12·motionScore.",
      },
      {
        label: "Kinematic Synthesis",
        detail: "For each hop window, synthesizePoseFrame() applies activity-specific mutations to the static base pose: Walking = sinusoidal knee/ankle stride + counter-phase arm swing at 1.25× Hz; Fallen = full horizontal keypoint remap; Sitting = fixed hip/knee offset + torso respiratory bob.",
      },
    ],
  },
  {
    id: "inference",
    number: "05",
    title: "Biometric Inference Engine",
    subtitle: "SMPL-fit Anthropometry · Body Fat · Qwen AI",
    color: "#f472b6",
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: 22, height: 22 }}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15M14.25 3.104c.251.023.501.05.75.082M19.8 15l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 01-6.23-.607L5 14.5m14.8.5l.391 1.561a2.25 2.25 0 01-2.185 2.814H6.001a2.25 2.25 0 01-2.185-2.814L4.198 15" />
      </svg>
    ),
    badges: ["Ramanujan Ellipse", "ANSUR-II / CAESAR", "8 Circumferences", "Qwen-Plus LLM"],
    summary: "WiFi CSI yields sparse bony-landmark distances (shoulder width, hip width, height). The SMPL-fit anthropometric regression engine applies Ramanujan's ellipse formula to cross-sections with CAESAR/ANSUR-II depth ratios to predict all 8 clinical body circumferences. Qwen-Plus then synthesizes a personalized clinical summary from vitals + morphometrics.",
    technical: [
      {
        label: "Ramanujan Ellipse Circumference",
        detail: "C = π(a+b)[1 + 3h/(10+√(4−3h))] where h=(a−b)²/(a+b)², a=half-width, b=half-depth. Depth ratios from CAESAR 3D scans: neck 0.87, chest 0.40×fatFactor, waist 0.82, hip 0.72 (0.75 female), thigh 0.86, calf 0.88.",
      },
      {
        label: "Body Fat Girth Factor",
        detail: "fatFactor = 1.0 + (BF% − 22) / 80. Calibrated so BF=22% → fatFactor=1.0 (average reference). Each 10pp increase in body fat increases trunk circumferences ~8%, consistent with Lean et al. (1996).",
      },
      {
        label: "Qwen AI Clinical Summary",
        detail: "Structured biometric bundle submitted via zero-shot prompt to Qwen-Plus (DashScope). Output: clinical summary, body fat classification, posture notes, estimated waist circumference, and actionable health recommendations. Falls back to rule-based engine if API key is absent. Source labeled transparently in UI.",
      },
    ],
  },
];

// ─── Sub-components ───────────────────────────────────────────────────────────
function Badge({ label, color }: { label: string; color: string }) {
  return (
    <span style={{
      fontSize: "0.65rem", fontWeight: 600, letterSpacing: "0.06em",
      textTransform: "uppercase", padding: "2px 8px", borderRadius: "999px",
      border: `1px solid ${color}50`, color, background: `${color}12`,
      whiteSpace: "nowrap",
    }}>
      {label}
    </span>
  );
}

function TechnicalBlock({ label, detail }: { label: string; detail: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{
      borderRadius: "0.5rem", overflow: "hidden",
      border: "1px solid #1e2a35", marginBottom: 6,
    }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: "100%", textAlign: "left", padding: "8px 12px",
          background: "#0d1117", border: "none", cursor: "pointer",
          display: "flex", justifyContent: "space-between", alignItems: "center",
          gap: 8,
        }}
      >
        <span style={{ fontSize: "0.75rem", fontWeight: 600, color: "#c8d8e8" }}>{label}</span>
        <span style={{ color: "#4a8fa8", fontSize: "1rem", lineHeight: 1, flexShrink: 0 }}>
          {open ? "−" : "+"}
        </span>
      </button>
      {open && (
        <div style={{
          padding: "8px 12px 10px", background: "#060a0d",
          borderTop: "1px solid #1e2a35",
          fontSize: "0.725rem", color: "#8b95a3", lineHeight: 1.7,
          fontFamily: "monospace",
        }}>
          {detail}
        </div>
      )}
    </div>
  );
}

function StageCard({ stage, isLast }: { stage: typeof STAGES[0]; isLast: boolean }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div style={{ display: "flex", gap: 0 }}>
      {/* Timeline spine */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 48 }}>
        {/* Number bubble */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: 40, height: 40, borderRadius: "50%", border: `2px solid ${stage.color}`,
            background: expanded ? `${stage.color}20` : "#0d1117",
            color: stage.color, fontSize: "0.75rem", fontWeight: 800,
            fontFamily: "monospace", cursor: "pointer", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s",
          }}
        >
          {stage.number}
        </button>
        {/* Connector line */}
        {!isLast && (
          <div style={{
            width: 2, flex: 1, minHeight: 32,
            background: `linear-gradient(to bottom, ${stage.color}60, #1e2a3500)`,
            margin: "4px 0",
          }} />
        )}
      </div>

      {/* Card content */}
      <div style={{ flex: 1, paddingLeft: 16, paddingBottom: isLast ? 0 : 24 }}>
        {/* Header row */}
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: "100%", textAlign: "left", background: "none", border: "none",
            cursor: "pointer", padding: 0, display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", gap: 12,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ color: stage.color }}>{stage.icon}</span>
              <span style={{
                fontSize: "0.95rem", fontWeight: 700, color: "#e2e8f0",
                letterSpacing: "-0.01em",
              }}>
                {stage.title}
              </span>
            </div>
            <span style={{ fontSize: "0.7rem", color: "#4a8fa8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {stage.subtitle}
            </span>
          </div>
          <span style={{
            color: "#4a8fa8", fontSize: "0.75rem", fontWeight: 600,
            flexShrink: 0, marginTop: 4,
            transform: expanded ? "rotate(180deg)" : "none",
            transition: "transform 0.2s",
            display: "inline-block",
          }}>▾</span>
        </button>

        {/* Badge row — always visible */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {stage.badges.map(b => <Badge key={b} label={b} color={stage.color} />)}
        </div>

        {/* Expanded body */}
        {expanded && (
          <div style={{ marginTop: 14 }}>
            {/* Summary paragraph */}
            <p style={{
              fontSize: "0.8rem", color: "#8fa8b8", lineHeight: 1.75,
              marginBottom: 14,
              padding: "10px 14px",
              background: "#0a1018",
              borderRadius: "0.5rem",
              borderLeft: `3px solid ${stage.color}40`,
            }}>
              {stage.summary}
            </p>

            {/* Technical accordion items */}
            <div>
              <p style={{ fontSize: "0.65rem", color: "#4a637a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Technical Detail
              </p>
              {stage.technical.map(t => (
                <TechnicalBlock key={t.label} label={t.label} detail={t.detail} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────
export default function HowItWorks() {
  const [allExpanded, setAllExpanded] = useState(false);

  return (
    <div style={{ padding: "0 0 8px" }}>
      {/* Header */}
      <div style={{ marginBottom: 20 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
          <div>
            <h2 style={{
              fontSize: "1.05rem", fontWeight: 800, color: "#e2e8f0",
              letterSpacing: "-0.02em", margin: 0,
            }}>
              How WALLNUT Works
            </h2>
            <p style={{ fontSize: "0.72rem", color: "#4a8fa8", margin: "3px 0 0" }}>
              From ambient WiFi signal to clinical biometric report — 5-stage pipeline
            </p>
          </div>
          <button
            onClick={() => setAllExpanded(e => !e)}
            style={{
              fontSize: "0.68rem", color: "#22d3ee", background: "#22d3ee12",
              border: "1px solid #22d3ee30", borderRadius: "0.4rem",
              padding: "4px 10px", cursor: "pointer", fontWeight: 600,
              letterSpacing: "0.05em", textTransform: "uppercase",
              whiteSpace: "nowrap",
            }}
          >
            {allExpanded ? "Collapse all" : "Expand all"}
          </button>
        </div>

        {/* Pipeline overview bar */}
        <div style={{
          display: "flex", alignItems: "center", gap: 0,
          padding: "8px 10px", borderRadius: "0.5rem",
          background: "#0a1018", border: "1px solid #1e2a35",
          overflowX: "auto",
        }}>
          {STAGES.map((s, i) => (
            <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 0, flexShrink: 0 }}>
              <span style={{
                fontSize: "0.62rem", color: s.color, fontWeight: 700,
                padding: "1px 6px",
                whiteSpace: "nowrap",
              }}>
                {s.number} {s.title.split(" ")[0]}
              </span>
              {i < STAGES.length - 1 && (
                <span style={{ color: "#1e2a35", fontSize: "0.8rem", margin: "0 2px" }}>›</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Stage cards */}
      <div>
        {STAGES.map((stage, i) => (
          <StageCardWrapper key={stage.id} stage={stage} isLast={i === STAGES.length - 1} forceExpanded={allExpanded} />
        ))}
      </div>

      {/* Footer note */}
      <div style={{
        marginTop: 12, padding: "8px 12px", borderRadius: "0.5rem",
        background: "#0a1018", border: "1px solid #1e2a35",
        fontSize: "0.65rem", color: "#4a637a", lineHeight: 1.6,
      }}>
        <strong style={{ color: "#4a8fa8" }}>Privacy:</strong>{" "}
        All CSI signal processing runs in the Next.js server runtime. Raw CSI data never leaves your machine unless you explicitly enable Qwen AI summarization, which transmits only structured numeric metrics — not raw signals.
        System is non-ionizing (≪ ICNIRP 10,000 mW/m² limit) and camera-free by design.
      </div>
    </div>
  );
}

// Wrapper to handle forceExpanded
function StageCardWrapper({ stage, isLast, forceExpanded }: {
  stage: typeof STAGES[0]; isLast: boolean; forceExpanded: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isOpen = expanded || forceExpanded;

  return (
    <div style={{ display: "flex", gap: 0 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 48 }}>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: 40, height: 40, borderRadius: "50%", border: `2px solid ${stage.color}`,
            background: isOpen ? `${stage.color}22` : "#0d1117",
            color: stage.color, fontSize: "0.75rem", fontWeight: 800,
            fontFamily: "monospace", cursor: "pointer", flexShrink: 0,
            display: "flex", alignItems: "center", justifyContent: "center",
            transition: "background 0.2s",
          }}
        >
          {stage.number}
        </button>
        {!isLast && (
          <div style={{
            width: 2, flex: 1, minHeight: 32,
            background: `linear-gradient(to bottom, ${stage.color}60, #1e2a3500)`,
            margin: "4px 0",
          }} />
        )}
      </div>

      <div style={{ flex: 1, paddingLeft: 16, paddingBottom: isLast ? 0 : 24 }}>
        <button
          onClick={() => setExpanded(e => !e)}
          style={{
            width: "100%", textAlign: "left", background: "none", border: "none",
            cursor: "pointer", padding: 0, display: "flex", alignItems: "flex-start",
            justifyContent: "space-between", gap: 12,
          }}
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 2 }}>
              <span style={{ color: stage.color }}>{stage.icon}</span>
              <span style={{ fontSize: "0.95rem", fontWeight: 700, color: "#e2e8f0" }}>
                {stage.title}
              </span>
            </div>
            <span style={{ fontSize: "0.7rem", color: "#4a8fa8", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              {stage.subtitle}
            </span>
          </div>
          <span style={{
            color: "#4a8fa8", fontSize: "0.75rem", fontWeight: 600, flexShrink: 0, marginTop: 4,
            transform: isOpen ? "rotate(180deg)" : "none", transition: "transform 0.2s", display: "inline-block",
          }}>▾</span>
        </button>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          {stage.badges.map(b => <Badge key={b} label={b} color={stage.color} />)}
        </div>

        {isOpen && (
          <div style={{ marginTop: 14 }}>
            <p style={{
              fontSize: "0.8rem", color: "#8fa8b8", lineHeight: 1.75, marginBottom: 14,
              padding: "10px 14px", background: "#0a1018", borderRadius: "0.5rem",
              borderLeft: `3px solid ${stage.color}40`,
            }}>
              {stage.summary}
            </p>
            <div>
              <p style={{ fontSize: "0.65rem", color: "#4a637a", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
                Technical Detail
              </p>
              {stage.technical.map(t => (
                <TechnicalBlock key={t.label} label={t.label} detail={t.detail} />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
