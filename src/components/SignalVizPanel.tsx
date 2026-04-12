"use client";

/**
 * SignalVizPanel.tsx
 * ──────────────────
 * Ported & adapted from RuView/ui/components/signal-viz.js
 *
 * Original: Three.js scene objects (PlaneGeometry cells, BufferGeometry lines,
 * BoxGeometry Doppler bars) rendered in a 3D scene.
 *
 * Our adaptation (no Three.js dependency here):
 *  • CSI Amplitude Heatmap  → Canvas 2D heatmap (30 subcarriers × 40 timeslots)
 *  • Phase Plot             → SVG polyline (phase across subcarriers)
 *  • Doppler Spectrum       → CSS/SVG bar chart  (16 bins)
 *  • Motion Indicator       → Pulsing animated badge
 *  All driven by the same generateDemoData() synthetic signal generator
 *  ported faithfully from the original.
 */

import { useEffect, useRef, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface CSIFrame {
  amplitude: Float32Array;   // length 30 — normalised 0–1
  phase:     Float32Array;   // length 30 — radians
  doppler:   Float32Array;   // length 16 — normalised 0–1
  motionEnergy: number;       // 0–1
}

// ─── Synthetic demo data ─────────────────────────────────────────────────────
export function generateDemoCSI(elapsed: number): CSIFrame {
  const N_SC = 30, N_DOP = 16;
  const amplitude = new Float32Array(N_SC);
  const phase     = new Float32Array(N_SC);
  const doppler   = new Float32Array(N_DOP);

  for (let i = 0; i < N_SC; i++) {
    const baseFreq  = Math.sin(elapsed * 2   + i * 0.30) * 0.30;
    const bodyEffect= Math.sin(elapsed * 0.8 + i * 0.15) * 0.25;
    const noise     = (Math.random() - 0.5) * 0.08;
    amplitude[i]    = Math.max(0, Math.min(1, 0.40 + baseFreq + bodyEffect + noise));
    const linearPh  = (i / N_SC) * Math.PI * 2;
    const bodyPh    = Math.sin(elapsed * 1.5 + i * 0.20) * 0.8;
    phase[i]        = linearPh + bodyPh;
  }

  const centerBin = N_DOP / 2 + Math.sin(elapsed * 0.7) * 3;
  for (let i = 0; i < N_DOP; i++) {
    const dist = Math.abs(i - centerBin);
    doppler[i] = Math.max(0, Math.min(1,
      Math.exp(-dist * dist * 0.15) * (0.6 + Math.sin(elapsed * 1.2) * 0.3)
      + (Math.random() - 0.5) * 0.04
    ));
  }

  return {
    amplitude, phase, doppler,
    motionEnergy: (Math.sin(elapsed * 0.5) + 1) / 2 * 0.7 + 0.15,
  };
}

// ─── HSL→CSS string for heatmap cells (matches signal-viz.js colour logic) ──
function ampToCSS(val: number) {
  const h = Math.round((0.6 - val * 0.6) * 360);
  const l = Math.round((0.10 + val * 0.50) * 100);
  return `hsl(${h},90%,${l}%)`;
}

// ─── Heatmap Canvas ───────────────────────────────────────────────────────────
const N_SC = 30, N_TIME = 40;

function AmplitudeHeatmap({ history }: { history: Float32Array[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const W = canvas.width, H = canvas.height;
    const cw = W / N_SC, ch = H / N_TIME;

    ctx.clearRect(0, 0, W, H);
    for (let t = 0; t < N_TIME; t++) {
      const row = history[t] ?? new Float32Array(N_SC);
      for (let s = 0; s < N_SC; s++) {
        ctx.fillStyle = ampToCSS(row[s] ?? 0);
        ctx.fillRect(
          s * cw + 0.5, t * ch + 0.5,
          cw  - 1,      ch  - 1
        );
      }
    }
    // Border
    ctx.strokeStyle = "rgba(40,80,120,0.35)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  });

  return (
    <div>
      <p style={{ fontSize: "0.55rem", color: "#5588aa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        CSI Amplitude  —  {N_SC} subcarriers × {N_TIME} slots
      </p>
      <canvas ref={canvasRef} width={270} height={112}
        style={{ display: "block", borderRadius: "0.25rem", background: "#050c14" }} />
      {/* X-axis label */}
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.5rem", color: "#334455", marginTop: 2 }}>
        <span>SC 0</span><span>SC 14</span><span>SC 29</span>
      </div>
    </div>
  );
}

// ─── Phase SVG Polyline ────────────────────────────────────────────────────────
function PhasePlot({ phase }: { phase: Float32Array }) {
  const W = 270, H = 60;
  const pts = Array.from(phase).map((v, i) => {
    const x = (i / (N_SC - 1)) * W;
    const y = H / 2 - (v / Math.PI) * (H / 2 - 4);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  // Colour by variance
  let mean = 0;
  phase.forEach(v => { mean += v; }); mean /= N_SC;
  let variance = 0;
  phase.forEach(v => { variance += (v - mean) ** 2; }); variance /= N_SC;
  const motionIntensity = Math.min(1, variance / 2);
  const h = Math.round((0.3 - motionIntensity * 0.15) * 360);
  const l = Math.round((35 + motionIntensity * 30));
  const lineColor = `hsl(${h},100%,${l}%)`;

  return (
    <div>
      <p style={{ fontSize: "0.55rem", color: "#5588aa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        Phase  —  Subcarrier profile (radians)
      </p>
      <svg width={W} height={H} style={{ display: "block", background: "#040a10", borderRadius: "0.25rem" }}>
        {/* Zero line */}
        <line x1={0} y1={H/2} x2={W} y2={H/2} stroke="#1e3040" strokeWidth={1} />
        {/* ±π lines */}
        <line x1={0} y1={4}   x2={W} y2={4}   stroke="#0d1f2a" strokeWidth={1} strokeDasharray="3,3" />
        <line x1={0} y1={H-4} x2={W} y2={H-4} stroke="#0d1f2a" strokeWidth={1} strokeDasharray="3,3" />
        <polyline points={pts} fill="none" stroke={lineColor} strokeWidth={1.5} />
      </svg>
    </div>
  );
}

// ─── Doppler Bars ─────────────────────────────────────────────────────────────
const N_DOP = 16;

function DopplerSpectrum({ doppler }: { doppler: Float32Array }) {
  const W = 270, H = 60;
  const barW = (W / N_DOP) * 0.78;
  const gap  = (W / N_DOP) * 0.22;

  return (
    <div>
      <p style={{ fontSize: "0.55rem", color: "#5588aa", textTransform: "uppercase", letterSpacing: "0.06em", marginBottom: 4 }}>
        Doppler Spectrum  —  Motion velocity bins
      </p>
      <svg width={W} height={H} style={{ display: "block", background: "#040a10", borderRadius: "0.25rem" }}>
        {/* Base line */}
        <line x1={0} y1={H-1} x2={W} y2={H-1} stroke="#1e3040" strokeWidth={1} />
        {Array.from(doppler).map((v, i) => {
          const barH = Math.max(1, v * (H - 4));
          const x = i * (W / N_DOP) + gap / 2;
          const hue = Math.round((0.7 - v * 0.3) * 360);
          const lum = Math.round(25 + v * 35);
          return (
            <rect key={i}
              x={x} y={H - 1 - barH} width={barW} height={barH}
              fill={`hsl(${hue},80%,${lum}%)`}
              style={{ transition: "height 0.08s, y 0.08s" }}
            />
          );
        })}
        {/* Center marker */}
        <line x1={W/2} y1={0} x2={W/2} y2={H} stroke="#1e3a50" strokeWidth={1} strokeDasharray="2,4" />
      </svg>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: "0.5rem", color: "#334455", marginTop: 2 }}>
        <span>-Fd</span><span>0</span><span>+Fd</span>
      </div>
    </div>
  );
}

// ─── Motion Indicator ─────────────────────────────────────────────────────────
function MotionIndicator({ energy }: { energy: number }) {
  const hue = Math.round((0.3 - energy * 0.2) * 360);
  const label = energy > 0.65 ? "HIGH" : energy > 0.3 ? "MED" : "LOW";
  const label_color = energy > 0.65 ? "#4ade80" : energy > 0.3 ? "#facc15" : "#64748b";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      {/* Pulsing core */}
      <div style={{ position: "relative", width: 44, height: 44, flexShrink: 0 }}>
        {/* Outer ring */}
        <div style={{
          position: "absolute", inset: 0, borderRadius: "50%",
          border: `1px solid hsl(${hue},100%,50%)`,
          opacity: 0.25 + energy * 0.55,
          transform: `scale(${1 + energy * 0.35})`,
          transition: "transform 0.3s, opacity 0.3s",
        }} />
        {/* Core */}
        <div style={{
          position: "absolute", inset: "20%", borderRadius: "50%",
          background: `radial-gradient(circle at 40% 40%, hsl(${hue},100%,${35 + Math.round(energy*30)}%), hsl(${hue},90%,12%))`,
          boxShadow: `0 0 ${8 + Math.round(energy * 12)}px hsl(${hue},100%,45%)`,
          transition: "background 0.3s, box-shadow 0.3s",
          animation: energy > 0.4 ? `motion-pulse ${(1.8 - energy * 1.0).toFixed(2)}s ease-in-out infinite` : "none",
        }} />
      </div>
      {/* Text */}
      <div>
        <div style={{ fontSize: "0.58rem", color: "#5588aa", textTransform: "uppercase", letterSpacing: "0.06em" }}>Motion</div>
        <div style={{ fontSize: "1.1rem", fontWeight: 800, color: label_color, lineHeight: 1, marginTop: 1 }}>{label}</div>
        <div style={{ fontSize: "0.6rem", color: "#4a637a", marginTop: 2 }}>{(energy * 100).toFixed(0)}% energy</div>
      </div>
    </div>
  );
}

// ─── Main Panel ───────────────────────────────────────────────────────────────
interface SignalVizProps {
  frame?: CSIFrame;    // if undefined, auto-runs demo mode
  compact?: boolean;
}

export default function SignalVizPanel({ frame, compact = false }: SignalVizProps) {
  const elapsedRef = useRef(0);
  const [current, setCurrent] = useState<CSIFrame>(() => generateDemoCSI(0));
  const [history, setHistory] = useState<Float32Array[]>(
    () => Array.from({ length: N_TIME }, () => new Float32Array(N_SC))
  );

  useEffect(() => {
    let animationFrameId = 0;
    const tick = () => {
      elapsedRef.current += 0.05;
      const csiFrame = frame ?? generateDemoCSI(elapsedRef.current);
      setHistory((prev) => [...prev.slice(1), new Float32Array(csiFrame.amplitude)]);
      setCurrent({ ...csiFrame });
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animationFrameId);
  }, [frame]);

  return (
    <>
      <style>{`@keyframes motion-pulse{0%,100%{transform:scale(0.92);opacity:0.7}50%{transform:scale(1.08);opacity:1}}`}</style>
      <div style={{
        display: "flex", flexDirection: "column", gap: compact ? 10 : 14,
        background: "#060c14", borderRadius: "0.75rem",
        padding: compact ? "12px" : "16px",
        border: "1px solid #0e1e2c",
      }}>
        {/* Panel header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div>
            <p style={{ fontSize: "0.72rem", fontWeight: 700, color: "#aaddff", letterSpacing: "0.06em", textTransform: "uppercase" }}>
              CSI Signal Observatory
            </p>
            <p style={{ fontSize: "0.58rem", color: "#4a637a", marginTop: 1 }}>
              802.11 OFDM · 5 GHz · {N_SC} subcarriers
            </p>
          </div>
          <div style={{
            fontSize: "0.58rem", color: "#22c55e", fontWeight: 600,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: "#22c55e", display: "inline-block", animation: "motion-pulse 1.5s ease-in-out infinite" }} />
            {frame ? "LIVE" : "DEMO"}
          </div>
        </div>

        {/* Heatmap */}
        <AmplitudeHeatmap history={history} />

        {/* Phase + Doppler side by side if not compact */}
        {compact ? (
          <>
            <PhasePlot phase={current.phase} />
            <DopplerSpectrum doppler={current.doppler} />
          </>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <PhasePlot phase={current.phase} />
            <DopplerSpectrum doppler={current.doppler} />
          </div>
        )}

        {/* Motion indicator */}
        <div style={{
          paddingTop: 10, borderTop: "1px solid #0e1e2c",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <MotionIndicator energy={current.motionEnergy} />
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: "0.58rem", color: "#4a637a" }}>Mean Amp</div>
            <div style={{ fontSize: "0.85rem", fontWeight: 700, color: "#aaddff", fontFamily: "monospace" }}>
              {(Array.from(current.amplitude).reduce((a, b) => a + b, 0) / N_SC * 100).toFixed(1)} dB
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
