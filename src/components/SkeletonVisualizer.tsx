"use client";

import type { Keypoint } from "@/lib/ruviewSimulator";

// ─── Skeleton connections ─────────────────────────────────────────────────────
const BONES: [string, string][] = [
  ["nose","left_eye"],["nose","right_eye"],
  ["left_eye","left_ear"],["right_eye","right_ear"],
  ["left_shoulder","right_shoulder"],
  ["left_shoulder","left_elbow"],["left_elbow","left_wrist"],
  ["right_shoulder","right_elbow"],["right_elbow","right_wrist"],
  ["left_shoulder","left_hip"],["right_shoulder","right_hip"],
  ["left_hip","right_hip"],
  ["left_hip","left_knee"],["left_knee","left_ankle"],
  ["right_hip","right_knee"],["right_knee","right_ankle"],
];

interface Props {
  keypoints: Keypoint[];
  width?: number;
  height?: number;
  animated?: boolean;
}

export default function BodyMeshVisualizer({ keypoints, width = 160, height = 300, animated = true }: Props) {
  const kp = Object.fromEntries(keypoints.map((k) => [k.point, k]));
  const pad = 14;
  const toX = (nx: number) => pad + nx * (width - pad * 2);
  const toY = (ny: number) => pad + ny * (height - pad * 2);

  // Key points
  const nose       = kp["nose"];
  const lShoulder  = kp["left_shoulder"];
  const rShoulder  = kp["right_shoulder"];
  const lHip       = kp["left_hip"];
  const rHip       = kp["right_hip"];
  const lKnee      = kp["left_knee"];
  const rKnee      = kp["right_knee"];
  const lAnkle     = kp["left_ankle"];
  const rAnkle     = kp["right_ankle"];
  const lElbow     = kp["left_elbow"];
  const rElbow     = kp["right_elbow"];
  const lWrist     = kp["left_wrist"];
  const rWrist     = kp["right_wrist"];

  // Derived anchor points
  const cx = toX(0.5);
  const headR  = (width - pad * 2) * 0.095;
  const headCy = nose ? toY(nose.y - 0.035) : toY(0.04);

  // Limb thickness helpers
  const limb = (conf: number) => Math.max(3, conf * 8);

  // Torso polygon from shoulder-to-hip trapezoid
  const torsoPath = (lShoulder && rShoulder && lHip && rHip)
    ? `M ${toX(lShoulder.x) - 2} ${toY(lShoulder.y)}
       L ${toX(rShoulder.x) + 2} ${toY(rShoulder.y)}
       L ${toX(rHip.x) + 2} ${toY(rHip.y)}
       L ${toX(lHip.x) - 2} ${toY(lHip.y)} Z`
    : null;

  return (
    <svg
      width={width} height={height}
      viewBox={`0 0 ${width} ${height}`}
      className="drop-shadow-[0_0_24px_rgba(56,189,248,0.25)]"
    >
      <defs>
        {/* Body glow */}
        <radialGradient id="bodyGlow" cx="50%" cy="40%" r="55%">
          <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.12" />
          <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
        </radialGradient>
        {/* Torso fill gradient */}
        <linearGradient id="torsoGrad" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#818cf8" stopOpacity="0.15" />
        </linearGradient>
        {/* Limb fill */}
        <linearGradient id="limbGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.35" />
          <stop offset="100%" stopColor="#38bdf8" stopOpacity="0.15" />
        </linearGradient>
        {/* Head glow filter */}
        <filter id="glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="2.5" result="blur" />
          <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
        </filter>
        {/* Scan line clip */}
        <clipPath id="bodyClip">
          <rect x="0" y="0" width={width} height={height} />
        </clipPath>
        {/* Mesh pattern */}
        <pattern id="meshPattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
          <path d="M 8 0 L 0 0 0 8" fill="none" stroke="#38bdf8" strokeWidth="0.3" strokeOpacity="0.18" />
        </pattern>
      </defs>

      {/* Ambient background glow */}
      <ellipse cx={cx} cy={height * 0.45} rx={width * 0.42} ry={height * 0.42} fill="url(#bodyGlow)" />

      {/* ─────── BODY MESH SHAPES ─────── */}

      {/* Head — sphere with mesh overlay */}
      <circle cx={cx} cy={headCy} r={headR + 1} fill="url(#torsoGrad)" stroke="#38bdf8" strokeWidth="1.2" strokeOpacity="0.6" filter="url(#glow)" />
      <circle cx={cx} cy={headCy} r={headR + 1} fill="url(#meshPattern)" opacity="0.8" />

      {/* Neck */}
      {nose && lShoulder && (
        <line
          x1={cx} y1={headCy + headR}
          x2={cx} y2={toY(lShoulder.y)}
          stroke="#38bdf8" strokeWidth="4" strokeOpacity="0.4" strokeLinecap="round"
        />
      )}

      {/* Torso — filled trapezoid with mesh */}
      {torsoPath && (
        <>
          <path d={torsoPath} fill="url(#torsoGrad)" stroke="#38bdf8" strokeWidth="1" strokeOpacity="0.5" />
          <path d={torsoPath} fill="url(#meshPattern)" />
          {/* Spine line */}
          {lShoulder && lHip && (
            <line
              x1={cx} y1={toY(lShoulder.y)}
              x2={cx} y2={toY(lHip.y)}
              stroke="#818cf8" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3,3"
            />
          )}
        </>
      )}

      {/* ─── LIMBS — thick rounded segments ─── */}

      {/* Left Upper Arm */}
      {lShoulder && lElbow && (
        <line x1={toX(lShoulder.x)} y1={toY(lShoulder.y)} x2={toX(lElbow.x)} y2={toY(lElbow.y)}
          stroke="#38bdf8" strokeWidth={limb(lShoulder.confidence)} strokeOpacity="0.4" strokeLinecap="round" />
      )}
      {/* Left Forearm */}
      {lElbow && lWrist && (
        <line x1={toX(lElbow.x)} y1={toY(lElbow.y)} x2={toX(lWrist.x)} y2={toY(lWrist.y)}
          stroke="#34d399" strokeWidth={limb(lElbow.confidence) * 0.85} strokeOpacity="0.4" strokeLinecap="round" />
      )}

      {/* Right Upper Arm */}
      {rShoulder && rElbow && (
        <line x1={toX(rShoulder.x)} y1={toY(rShoulder.y)} x2={toX(rElbow.x)} y2={toY(rElbow.y)}
          stroke="#38bdf8" strokeWidth={limb(rShoulder.confidence)} strokeOpacity="0.4" strokeLinecap="round" />
      )}
      {/* Right Forearm */}
      {rElbow && rWrist && (
        <line x1={toX(rElbow.x)} y1={toY(rElbow.y)} x2={toX(rWrist.x)} y2={toY(rWrist.y)}
          stroke="#34d399" strokeWidth={limb(rElbow.confidence) * 0.85} strokeOpacity="0.4" strokeLinecap="round" />
      )}

      {/* Hips connector */}
      {lHip && rHip && (
        <line x1={toX(lHip.x)} y1={toY(lHip.y)} x2={toX(rHip.x)} y2={toY(rHip.y)}
          stroke="#a78bfa" strokeWidth="4" strokeOpacity="0.45" strokeLinecap="round" />
      )}

      {/* Left Upper Leg */}
      {lHip && lKnee && (
        <line x1={toX(lHip.x)} y1={toY(lHip.y)} x2={toX(lKnee.x)} y2={toY(lKnee.y)}
          stroke="#818cf8" strokeWidth={limb(lHip.confidence)} strokeOpacity="0.45" strokeLinecap="round" />
      )}
      {/* Left Lower Leg */}
      {lKnee && lAnkle && (
        <line x1={toX(lKnee.x)} y1={toY(lKnee.y)} x2={toX(lAnkle.x)} y2={toY(lAnkle.y)}
          stroke="#818cf8" strokeWidth={limb(lKnee.confidence) * 0.8} strokeOpacity="0.4" strokeLinecap="round" />
      )}

      {/* Right Upper Leg */}
      {rHip && rKnee && (
        <line x1={toX(rHip.x)} y1={toY(rHip.y)} x2={toX(rKnee.x)} y2={toY(rKnee.y)}
          stroke="#818cf8" strokeWidth={limb(rHip.confidence)} strokeOpacity="0.45" strokeLinecap="round" />
      )}
      {/* Right Lower Leg */}
      {rKnee && rAnkle && (
        <line x1={toX(rKnee.x)} y1={toY(rKnee.y)} x2={toX(rAnkle.x)} y2={toY(rAnkle.y)}
          stroke="#818cf8" strokeWidth={limb(rKnee.confidence) * 0.8} strokeOpacity="0.4" strokeLinecap="round" />
      )}

      {/* ─── SKELETON OVERLAY — precision joint dots ─── */}
      {BONES.map(([from, to]) => {
        const a = kp[from]; const b = kp[to];
        if (!a || !b) return null;
        return (
          <line key={`${from}-${to}`}
            x1={toX(a.x)} y1={toY(a.y)} x2={toX(b.x)} y2={toY(b.y)}
            stroke="#38bdf8" strokeWidth="1.2" strokeOpacity={0.55 * Math.min(a.confidence, b.confidence)}
            strokeLinecap="round" />
        );
      })}

      {/* Joint dots */}
      {keypoints.map((k) => {
        const isHead = ["nose","left_eye","right_eye","left_ear","right_ear"].includes(k.point);
        const isHip = k.point.includes("hip");
        const r = isHead ? 3.5 : isHip ? 3 : 2.5;
        const color = isHead ? "#38bdf8" : isHip ? "#a78bfa" : "#e2e8f0";
        return (
          <g key={k.point}>
            {animated && (
              <circle cx={toX(k.x)} cy={toY(k.y)} r={r + 3} fill={color} fillOpacity={0.08}>
                <animate attributeName="r" values={`${r+2};${r+5};${r+2}`}
                  dur={`${1.8 + Math.random() * 0.6}s`} repeatCount="indefinite" />
              </circle>
            )}
            <circle cx={toX(k.x)} cy={toY(k.y)} r={r}
              fill={color} fillOpacity={k.confidence}
              stroke="white" strokeWidth="0.5" strokeOpacity={0.3}
              filter="url(#glow)" />
          </g>
        );
      })}

      {/* Animated scan line */}
      {animated && (
        <g clipPath="url(#bodyClip)">
          <line x1="0" x2={width} y1="0" y2="0" stroke="#38bdf8" strokeWidth="1.5" strokeOpacity="0.5">
            <animateTransform attributeName="transform" type="translate" values={`0,0;0,${height};0,0`}
              dur="3s" repeatCount="indefinite" />
          </line>
        </g>
      )}

      {/* Confidence halo on head */}
      {nose && animated && (
        <circle cx={cx} cy={headCy} r={headR * 2.2} fill="none"
          stroke="#38bdf8" strokeWidth="0.8" strokeOpacity="0.15">
          <animate attributeName="r" values={`${headR*1.8};${headR*2.4};${headR*1.8}`} dur="2.5s" repeatCount="indefinite" />
          <animate attributeName="stroke-opacity" values="0.2;0.05;0.2" dur="2.5s" repeatCount="indefinite" />
        </circle>
      )}
    </svg>
  );
}
