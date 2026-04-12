"use client";

/**
 * LivePoseFusion.tsx
 * ──────────────────
 * Ported from RuView/ui/utils/pose-renderer.js (PoseRenderer class)
 *
 * Original: Imperative Canvas2D class with:
 *  ‣ 4 render modes: skeleton / keypoints / heatmap / dense
 *  ‣ Exponential lerp smoothing between frames (_getSmoothedKeypoints)
 *  ‣ COCO-17 skeleton connection topology
 *  ‣ Confidence-weighted gradient bone colours
 *  ‣ Gaussian radial-gradient blobs on keypoints (heatmap mode)
 *  ‣ Dense body-part segmentation fills (dense mode)
 *
 * Our adaptation:
 *  ‣ useRef canvas hook replaces the class constructor/dispose lifecycle
 *  ‣ useAnimationFrame drives the render loop
 *  ‣ renderMode prop replaces setMode()
 *  ‣ Lerp smoothing preserved as a Ref-cached map
 *  ‣ Demo synthetic poses simulate CSI-derived skeleton sequences
 */

import { useEffect, useRef, useState } from "react";

// ─── Types ─────────────────────────────────────────────────────────────────────
export interface Keypoint {
  x: number;           // normalised 0–1
  y: number;
  confidence: number;  // 0–1
  name?: string;
}

export interface PosePerson {
  keypoints: Keypoint[];
  confidence: number;
  id?: number;
}

export interface PoseFrame {
  persons: PosePerson[];
  timestamp?: number;
}

export type RenderMode = "skeleton" | "keypoints" | "heatmap" | "dense";

interface Props {
  frame?: PoseFrame;
  renderMode?: RenderMode;
  width?: number;
  height?: number;
  className?: string;
}

// ─── COCO-17 skeleton connections (from RuView pose-renderer.js) ──────────────
const SKELETON: [number, number][] = [
  [15,13],[13,11],[16,14],[14,12],[11,12],
  [5,11],[6,12],[5,6],
  [5,7],[6,8],[7,9],[8,10],
  [11,13],[12,14],[13,15],[14,16],
];

// Segment colour map (matches RuView's dense mode part colours)
const BODY_PARTS = [
  { name:"head",      kps:[0,1,2,3,4],    fill:"rgba(255,100,100,0.42)", stroke:"rgba(255,100,100,0.75)" },
  { name:"torso",     kps:[5,6,12,11],    fill:"rgba(100,200,255,0.42)", stroke:"rgba(100,200,255,0.75)" },
  { name:"left_arm",  kps:[5,7,9],        fill:"rgba(100,255,150,0.42)", stroke:"rgba(100,255,150,0.75)" },
  { name:"right_arm", kps:[6,8,10],       fill:"rgba(255,200,100,0.42)", stroke:"rgba(255,200,100,0.75)" },
  { name:"left_leg",  kps:[11,13,15],     fill:"rgba(200,100,255,0.42)", stroke:"rgba(200,100,255,0.75)" },
  { name:"right_leg", kps:[12,14,16],     fill:"rgba(255,255,100,0.42)", stroke:"rgba(255,255,100,0.75)" },
];

// Per-keypoint colours for enhanced keypoints mode
const KP_COLORS = [
  "#ff4444","#ff5533","#ff8800","#ffcc00","#aaffaa","#22ff77","#22ffcc","#00eeff",
  "#3399ff","#4466ff","#7744ff","#aa22ff","#ff22cc","#ff2288","#ff4466","#ff8888","#ffbbaa","#ffddaa",
];

// ─── Synthetic skeleton demo data ─────────────────────────────────────────────
function generateDemoPose(t: number): PoseFrame {
  const breathOff = Math.sin(t * 0.25) * 0.008;
  const sway      = Math.sin(t * 0.18) * 0.012;

  // Canonical A-pose with micro-animation
  const kps: Keypoint[] = [
    { x:0.50, y:0.12+breathOff,   confidence:0.96 }, // 0 nose
    { x:0.46, y:0.10,              confidence:0.88 }, // 1 left_eye
    { x:0.54, y:0.10,              confidence:0.88 }, // 2 right_eye
    { x:0.43, y:0.11,              confidence:0.78 }, // 3 left_ear
    { x:0.57, y:0.11,              confidence:0.78 }, // 4 right_ear
    { x:0.37+sway, y:0.32+breathOff, confidence:0.92 }, // 5 left_shoulder
    { x:0.63+sway, y:0.32+breathOff, confidence:0.92 }, // 6 right_shoulder
    { x:0.28+sway, y:0.50,         confidence:0.85 }, // 7 left_elbow
    { x:0.72+sway, y:0.50,         confidence:0.85 }, // 8 right_elbow
    { x:0.22+sway, y:0.67,         confidence:0.78 }, // 9 left_wrist
    { x:0.78+sway, y:0.67,         confidence:0.78 }, // 10 right_wrist
    { x:0.42, y:0.60+breathOff,    confidence:0.91 }, // 11 left_hip
    { x:0.58, y:0.60+breathOff,    confidence:0.91 }, // 12 right_hip
    { x:0.40, y:0.78,              confidence:0.84 }, // 13 left_knee
    { x:0.60, y:0.78,              confidence:0.84 }, // 14 right_knee
    { x:0.39, y:0.94,              confidence:0.80 }, // 15 left_ankle
    { x:0.61, y:0.94,              confidence:0.80 }, // 16 right_ankle
  ];
  return { persons: [{ keypoints: kps, confidence: 0.89 }], timestamp: Date.now() };
}

// ─── Lerp smoothing (mirrors RuView's _getSmoothedKeypoints) ─────────────────
const LERP_ALPHA = 0.28;

function lerpKeypoints(
  prev: Keypoint[] | undefined,
  next: Keypoint[]
): Keypoint[] {
  if (!prev || prev.length !== next.length) return next;
  return next.map((kp, i) => ({
    ...kp,
    x: prev[i].x + (kp.x - prev[i].x) * LERP_ALPHA,
    y: prev[i].y + (kp.y - prev[i].y) * LERP_ALPHA,
  }));
}

// ─── Canvas renderer ──────────────────────────────────────────────────────────
function renderFrame(
  ctx:    CanvasRenderingContext2D,
  W:      number,
  H:      number,
  pose:   PoseFrame,
  mode:   RenderMode,
  smooth: React.MutableRefObject<Map<number, Keypoint[]>>
) {
  ctx.clearRect(0, 0, W, H);

  const sx = (x: number) => x * W;
  const sy = (y: number) => y * H;

  pose.persons.forEach((person, idx) => {
    if (person.confidence < 0.15) return;
    const raw = person.keypoints;
    const prev = smooth.current.get(idx);
    const kps  = lerpKeypoints(prev, raw);
    smooth.current.set(idx, kps);

    const THRESH = 0.12;

    // ── SKELETON mode ──────────────────────────────────────────────────────
    if (mode === "skeleton" || mode === "keypoints") {
      if (mode === "skeleton") {
        SKELETON.forEach(([a, b]) => {
          const ka = kps[a], kb = kps[b];
          if (!ka || !kb || ka.confidence < THRESH || kb.confidence < THRESH) return;
          const x1 = sx(ka.x), y1 = sy(ka.y);
          const x2 = sx(kb.x), y2 = sy(kb.y);
          const conf = (ka.confidence + kb.confidence) / 2;

          const grad = ctx.createLinearGradient(x1, y1, x2, y2);
          const alpha = (v: number) => `rgba(0,255,136,${(v*0.8).toFixed(2)})`;
          grad.addColorStop(0, alpha(ka.confidence));
          grad.addColorStop(1, alpha(kb.confidence));

          ctx.strokeStyle = grad;
          ctx.lineWidth   = Math.max(1.5, 2.5 * conf);
          ctx.lineCap     = "round";
          if (conf > 0.8) { ctx.shadowColor = "#00ff88"; ctx.shadowBlur = 4; }
          ctx.globalAlpha = Math.min(1, person.confidence * 1.3);
          ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
          ctx.shadowBlur  = 0;
        });
      }

      // Keypoints
      kps.forEach((kp, ki) => {
        if (kp.confidence < THRESH) return;
        const x = sx(kp.x), y = sy(kp.y);
        const r = Math.max(2.5, 4 + (kp.confidence - 0.5) * 3);
        const color = mode === "keypoints" ? (KP_COLORS[ki % KP_COLORS.length] + "dd") : "#00ff88";

        if (kp.confidence > 0.75) { ctx.shadowColor = color; ctx.shadowBlur = 6; }
        const grd = ctx.createRadialGradient(x, y, 0, x, y, r);
        grd.addColorStop(0, color);
        grd.addColorStop(1, color.slice(0, 7) + "33");
        ctx.fillStyle    = grd;
        ctx.globalAlpha  = Math.min(1, kp.confidence + 0.25);
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur   = 0;
      });

      ctx.globalAlpha = 1;
    }

    // ── HEATMAP mode ──────────────────────────────────────────────────────
    if (mode === "heatmap") {
      const hue = (idx * 60) % 360;
      kps.forEach(kp => {
        if (kp.confidence < THRESH) return;
        const x = sx(kp.x), y = sy(kp.y), r = 28 + kp.confidence * 22;
        const g = ctx.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, `hsla(${hue},100%,55%,${kp.confidence * 0.7})`);
        g.addColorStop(0.5, `hsla(${hue},100%,45%,${kp.confidence * 0.3})`);
        g.addColorStop(1, `hsla(${hue},100%,40%,0)`);
        ctx.fillStyle = g;
        ctx.fillRect(x - r, y - r, r * 2, r * 2);
      });
      // Subtle skeleton overlay
      ctx.globalAlpha = 0.25;
      SKELETON.forEach(([a, b]) => {
        const ka = kps[a], kb = kps[b];
        if (!ka || !kb || ka.confidence < THRESH || kb.confidence < THRESH) return;
        ctx.strokeStyle = `hsl(${hue},100%,55%)`;
        ctx.lineWidth = 1.5; ctx.globalAlpha = 0.2;
        ctx.beginPath(); ctx.moveTo(sx(ka.x), sy(ka.y)); ctx.lineTo(sx(kb.x), sy(kb.y)); ctx.stroke();
      });
      ctx.globalAlpha = 1;
    }

    // ── DENSE mode ────────────────────────────────────────────────────────
    if (mode === "dense") {
      BODY_PARTS.forEach(part => {
        const pts = part.kps
          .filter(i => kps[i] && kps[i].confidence > THRESH)
          .map(i => ({ x: sx(kps[i].x), y: sy(kps[i].y) }));
        if (pts.length < 2) return;

        ctx.strokeStyle = part.stroke;
        ctx.lineWidth   = 10;
        ctx.lineJoin    = "round";
        ctx.lineCap     = "round";
        ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
        pts.slice(1).forEach(p => ctx.lineTo(p.x, p.y));
        ctx.stroke();

        ctx.fillStyle = part.fill;
        pts.forEach(p => {
          ctx.beginPath(); ctx.arc(p.x, p.y, 11, 0, Math.PI * 2); ctx.fill();
        });
      });
      // Subtle keypoints
      kps.forEach((kp) => {
        if (kp.confidence < THRESH) return;
        ctx.fillStyle = "rgba(255,255,255,0.35)";
        ctx.beginPath(); ctx.arc(sx(kp.x), sy(kp.y), 3, 0, Math.PI * 2); ctx.fill();
      });
    }

    // Confidence label
    const firstKP = kps.find(k => k.confidence > THRESH);
    if (firstKP) {
      ctx.fillStyle = "rgba(150,200,255,0.6)";
      ctx.font = "10px monospace";
      ctx.fillText(`${(person.confidence * 100).toFixed(0)}%`, sx(firstKP.x) + 6, sy(firstKP.y) - 8);
    }
  });
}

// ─── Main component ───────────────────────────────────────────────────────────
const MODE_LABELS: Record<RenderMode, string> = {
  skeleton: "Skeleton", keypoints: "Keypoints", heatmap: "Heatmap", dense: "Dense",
};

export default function LivePoseFusion({
  frame,
  renderMode = "skeleton",
  width = 360,
  height = 480,
  className = "",
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const smoothRef = useRef<Map<number, Keypoint[]>>(new Map());
  const tRef      = useRef(0);
  const [mode, setMode] = useState<RenderMode>(renderMode);
  const [activePose, setActivePose] = useState<PoseFrame | null>(null);

  useEffect(() => {
    let animationFrameId = 0;
    const drawFrame = () => {
      tRef.current += 0.04;
      const pose = frame ?? generateDemoPose(tRef.current);
      setActivePose(pose);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext("2d");
        if (ctx) {
          renderFrame(ctx, width, height, pose, mode, smoothRef);
        }
      }

      animationFrameId = requestAnimationFrame(drawFrame);
    };

    animationFrameId = requestAnimationFrame(drawFrame);
    return () => cancelAnimationFrame(animationFrameId);
  }, [frame, mode, width, height]);

  const person = activePose?.persons[0];

  return (
    <div className={className} style={{ display: "flex", flexDirection: "column", background: "#060a0e", borderRadius: "0.75rem", overflow: "hidden", border: "1px solid #0e1e2c" }}>
      {/* Header */}
      <div style={{ padding: "8px 12px", background: "#040810", borderBottom: "1px solid #0e1e2c", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <p style={{ fontSize: "0.68rem", fontWeight: 700, color: "#aaddff", textTransform: "uppercase", letterSpacing: "0.07em" }}>
            Pose Fusion
          </p>
          <p style={{ fontSize: "0.56rem", color: "#4a637a" }}>COCO-17 · lerp-smoothed</p>
        </div>
        <div style={{ display: "flex", gap: 4 }}>
          {(["skeleton","keypoints","heatmap","dense"] as RenderMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} style={{
              fontSize: "0.58rem", padding: "2px 7px", borderRadius: 4,
              background: mode === m ? "#0ea5e9" : "#0e1e2c",
              border: "1px solid",
              borderColor: mode === m ? "#0ea5e9" : "#1e2a35",
              color: mode === m ? "#fff" : "#4a8fa8",
              cursor: "pointer", fontWeight: 600, textTransform: "capitalize",
            }}>{MODE_LABELS[m]}</button>
          ))}
        </div>
      </div>

      {/* Canvas */}
      <div style={{ position: "relative", background: "#020608" }}>
        <canvas ref={canvasRef} width={width} height={height} style={{ display: "block", width: "100%", height: "auto" }} />
        {/* Scan-line overlay */}
        <div style={{
          position: "absolute", inset: 0, pointerEvents: "none",
          background: "repeating-linear-gradient(0deg, rgba(0,0,0,0) 0px, rgba(0,0,0,0) 2px, rgba(0,0,0,0.05) 2px, rgba(0,0,0,0.05) 3px)",
        }} />
      </div>

      {/* Stats bar */}
      <div style={{
        padding: "6px 12px", background: "#040810", borderTop: "1px solid #0e1e2c",
        display: "flex", gap: 16, alignItems: "center",
      }}>
        {[
          ["Persons",    activePose?.persons.length ?? 0],
          ["Confidence", person ? `${(person.confidence * 100).toFixed(1)}%` : "—"],
          ["Mode",       MODE_LABELS[mode]],
        ].map(([label, value]) => (
          <div key={label}>
            <div style={{ fontSize: "0.52rem", color: "#4a637a", textTransform: "uppercase", letterSpacing: "0.05em" }}>{label}</div>
            <div style={{ fontSize: "0.72rem", fontWeight: 700, color: "#88ccff", fontFamily: "monospace" }}>{value}</div>
          </div>
        ))}
        <div style={{ marginLeft: "auto", fontSize: "0.55rem", color: "#334455" }}>
          {frame ? "LIVE" : "DEMO · synthetic"}
        </div>
      </div>
    </div>
  );
}
