"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Html } from "@react-three/drei";
import * as THREE from "three";
import type { BodyCircumferences } from "@/lib/anthropometricModel";
import { MEASUREMENT_ORDER } from "@/lib/anthropometricModel";

// ─── Types ────────────────────────────────────────────────────────────────────
interface BodyMetrics {
  estimatedHeightCm: number;
  shoulderWidthCm: number;
  hipWidthCm: number;
  torsoLengthCm: number;
  leftArmLengthCm: number;
  rightArmLengthCm: number;
  leftLegLengthCm: number;
  bmi_proxy: number;
}

interface PoseKeypoint {
  point: string;
  x: number;
  y: number;
  confidence: number;
}

interface PoseSequenceFrame {
  t: number;
  keypoints: PoseKeypoint[];
  confidence: number;
  motionScore: number;
}

interface Props {
  keypoints?: PoseKeypoint[];
  keypointSequence?: PoseSequenceFrame[];
  dominantMotionHz?: number;
  breathingHz?: number;
  minHeight?: number | string;
  bodyMetrics: BodyMetrics;
  bodyFatPercent: number;
  classification: string;
  measurements: BodyCircumferences;
}

const CANONICAL_POSE_2D: Record<string, [number, number]> = {
  nose: [0.50, 0.06],
  left_eye: [0.47, 0.04],
  right_eye: [0.53, 0.04],
  left_ear: [0.44, 0.05],
  right_ear: [0.56, 0.05],
  left_shoulder: [0.38, 0.20],
  right_shoulder: [0.62, 0.20],
  left_elbow: [0.30, 0.38],
  right_elbow: [0.70, 0.38],
  left_wrist: [0.25, 0.54],
  right_wrist: [0.75, 0.54],
  left_hip: [0.42, 0.52],
  right_hip: [0.58, 0.52],
  left_knee: [0.40, 0.72],
  right_knee: [0.60, 0.72],
  left_ankle: [0.40, 0.92],
  right_ankle: [0.60, 0.92],
};

// ─── Clinical colour by body-fat tier ────────────────────────────────────────
function fatHex(pct: number): string {
  if (pct < 10) return "#f59e0b";
  if (pct < 25) return "#22c55e";
  if (pct < 32) return "#f97316";
  return "#ef4444";
}

// ─── Limb: capsule oriented between two 3D points ────────────────────────────
function Limb({
  from, to, radius, color, opacity = 0.82,
}: {
  from: [number, number, number];
  to:   [number, number, number];
  radius: number;
  color: string;
  opacity?: number;
}) {
  const fV = useMemo(() => new THREE.Vector3(...from), [from]);
  const tV = useMemo(() => new THREE.Vector3(...to),   [to]);

  const { mid, capLen, quat } = useMemo(() => {
    const dir = tV.clone().sub(fV);
    const len = dir.length();
    const capLen = Math.max(0, len - radius * 2);
    const mid = fV.clone().lerp(tV, 0.5);
    const up = new THREE.Vector3(0, 1, 0);
    const nd = dir.normalize();
    let q: THREE.Quaternion;
    if (nd.dot(up) > 0.9999)        q = new THREE.Quaternion();
    else if (nd.dot(up) < -0.9999)  q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1,0,0), Math.PI);
    else                             q = new THREE.Quaternion().setFromUnitVectors(up, nd);
    return { mid, capLen, quat: q };
  }, [fV, tV, radius]);

  return (
    <group position={mid} quaternion={quat}>
      <mesh castShadow receiveShadow>
        <capsuleGeometry args={[radius, capLen, 6, 14]} />
        <meshStandardMaterial color={color} roughness={0.45} metalness={0.05} transparent opacity={opacity} />
      </mesh>
      <mesh>
        <capsuleGeometry args={[radius * 1.02, capLen, 5, 10]} />
        <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.12} />
      </mesh>
    </group>
  );
}

// ─── Tapered torso segment (CylinderGeometry, elliptical cross-section) ───────
function TorsoSegment({ yB, yT, rB, rT, dz, color, opacity = 0.80, cx = 0 }: {
  yB: number; yT: number; rB: number; rT: number; dz: number;
  cx?: number;
  color: string; opacity?: number;
}) {
  const h = yT - yB;
  const cy = yB + h / 2;
  return (
    <group position={[cx, cy, 0]} scale={[1, 1, dz]}>
      <mesh castShadow receiveShadow>
        <cylinderGeometry args={[rT, rB, h, 20, 1]} />
        <meshStandardMaterial color={color} roughness={0.4} metalness={0.05} transparent opacity={opacity} />
      </mesh>
      <mesh>
        <cylinderGeometry args={[rT*1.02, rB*1.02, h, 14, 1]} />
        <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.10} />
      </mesh>
    </group>
  );
}

// ─── Joint sphere ─────────────────────────────────────────────────────────────
function Joint({ pos, r }: { pos: [number,number,number]; r: number }) {
  return (
    <mesh position={pos}>
      <sphereGeometry args={[r, 12, 12]} />
      <meshStandardMaterial color="#38bdf8" emissive="#38bdf8" emissiveIntensity={0.5}
        roughness={0.2} metalness={0.3} transparent opacity={0.9} />
    </mesh>
  );
}

// ─── Thin connector line from body to label ───────────────────────────────────
function ConnectorLine({ from, to }: { from: [number,number,number]; to: [number,number,number] }) {
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setFromPoints([new THREE.Vector3(...from), new THREE.Vector3(...to)]);
    return g;
  }, [from, to]);
  return (
    <primitive object={new THREE.Line(
      geo,
      new THREE.LineBasicMaterial({ color: "#4a6070", transparent: true, opacity: 0.6 })
    )} />
  );
}

// ─── Measurement label (Html overlay in 3D space) ────────────────────────────
function MeasurementLabel({
  position, label, value, side,
}: {
  position: [number,number,number];
  label: string;
  value: number;
  side: "left" | "right";
}) {
  return (
    <Html
      position={position}
      center={false}
      style={{ pointerEvents: "none", userSelect: "none" }}
      distanceFactor={6}
    >
      <div
        style={{
          display: "flex",
          flexDirection: side === "left" ? "row-reverse" : "row",
          alignItems: "center",
          gap: "4px",
          transform: side === "left" ? "translateX(-100%)" : "translateX(0)",
          whiteSpace: "nowrap",
        }}
      >
        <div
          style={{
            textAlign: side === "left" ? "right" : "left",
            lineHeight: 1.3,
          }}
        >
          <div style={{ fontSize: "9px", color: "#8b95a3", letterSpacing: "0.06em", textTransform: "uppercase" }}>
            {label}
          </div>
          <div style={{ fontSize: "11px", color: "#e2e8f0", fontWeight: 700, fontFamily: "monospace" }}>
            {value} cm
          </div>
        </div>
        <div
          style={{
            width: "16px",
            height: "1px",
            background: "rgba(74,96,112,0.8)",
            flexShrink: 0,
          }}
        />
      </div>
    </Html>
  );
}

// ─── Animated scan ring ───────────────────────────────────────────────────────
function ScanRing({ bodyBottom, bodyTop }: { bodyBottom: number; bodyTop: number }) {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * 0.38) % 1;
    ref.current.position.y = bodyBottom + t * (bodyTop - bodyBottom);
    (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * Math.sin(t * Math.PI);
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]}>
      <ringGeometry args={[0.05, 0.5, 48]} />
      <meshBasicMaterial color="#22d3ee" transparent opacity={0.4} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  );
}

// ─── Complete human body in A-pose with measurement overlays ─────────────────
function HumanBody({
  bodyMetrics,
  bodyFatPercent,
  measurements,
  spinning,
  poseKeypoints,
  breathingHz,
}: {
  bodyMetrics: BodyMetrics;
  bodyFatPercent: number;
  measurements: BodyCircumferences;
  spinning: boolean;
  poseKeypoints?: PoseKeypoint[];
  breathingHz?: number;
}) {
  type V3 = [number, number, number];
  const groupRef = useRef<THREE.Group>(null!);
  const torsoRef = useRef<THREE.Group>(null!);
  useFrame(({ clock }, delta) => {
    if (spinning) groupRef.current.rotation.y += delta * 0.28;
    if (torsoRef.current) {
      const hz = breathingHz && breathingHz > 0 ? breathingHz : 0.25;
      const amp = 0.015;
      const pulse = 1 + Math.sin(clock.elapsedTime * 2 * Math.PI * hz) * amp;
      torsoRef.current.scale.set(1, pulse * 0.96, pulse);
    }
  });

  // ── Body geometry proportions ───────────────────────────────────────────────
  const H = 2.0;
  const s = H / bodyMetrics.estimatedHeightCm;

  const SW = (bodyMetrics.shoulderWidthCm / 2) * s;
  const HW = (bodyMetrics.hipWidthCm / 2) * s;
  const chestW = SW * 0.92;

  const legLen    = bodyMetrics.leftLegLengthCm * s;
  const shinH     = legLen * 0.46;
  const thighH    = legLen * 0.50;
  const torsoH    = bodyMetrics.torsoLengthCm * s;
  const armLen    = bodyMetrics.leftArmLengthCm * s;
  const upperArmH = armLen * 0.52;
  const forearmH  = armLen * 0.44;

  const FOOT_Y  = -1.0;
  const ANKLE_Y = FOOT_Y + 0.03;
  const KNEE_Y  = ANKLE_Y + shinH;
  const HIP_Y   = KNEE_Y + thighH;
  const SHLD_Y  = HIP_Y + torsoH;
  const NECK_Y  = SHLD_Y + H * 0.04;
  const CHIN_Y  = NECK_Y + H * 0.04;
  const HEAD_Y  = CHIN_Y + H * 0.09;
  const HEAD_R  = H * 0.082;
  const ELBOW_Y = SHLD_Y - upperArmH;
  const WRIST_Y = ELBOW_Y - forearmH;

  const neckR     = SW * 0.17;
  const upperArmR = SW * 0.17;
  const forearmR  = SW * 0.13;
  const handR     = forearmR * 0.85;
  const thighR    = HW * 0.30;
  const shinR     = thighR * 0.72;
  const footR     = shinR * 0.55;

  const fatF = 1.0 + Math.max(0, bodyFatPercent - 15) / 55;
  const torsoDepth = 0.52 * fatF;
  const color = fatHex(bodyFatPercent);

  const eoF = 1.05;
  const efF = 0.08;
  const woF = 1.12;
  const wfF = 0.14;

  const poseMap = useMemo(
    () =>
      Object.fromEntries(
        (poseKeypoints ?? []).map((keypoint) => [keypoint.point, keypoint])
      ) as Record<string, PoseKeypoint>,
    [poseKeypoints]
  );

  const poseGainX = Math.max(0.16, SW * 2.4);
  const poseGainY = Math.max(0.18, torsoH * 1.4);
  const offsetFor = (pointName: string, gainX = poseGainX, gainY = poseGainY): [number, number] => {
    const current = poseMap[pointName];
    const canonical = CANONICAL_POSE_2D[pointName];
    if (!current || !canonical) return [0, 0];
    return [(current.x - canonical[0]) * gainX, (current.y - canonical[1]) * gainY];
  };

  const [noseDx, noseDy] = offsetFor("nose", poseGainX * 0.7, poseGainY);
  const headPos: V3 = [noseDx * 0.6, HEAD_Y + noseDy, 0];

  const [lsDx, lsDy] = offsetFor("left_shoulder");
  const [rsDx, rsDy] = offsetFor("right_shoulder");
  const [leDx, leDy] = offsetFor("left_elbow");
  const [reDx, reDy] = offsetFor("right_elbow");
  const [lwDx, lwDy] = offsetFor("left_wrist");
  const [rwDx, rwDy] = offsetFor("right_wrist");
  const [lhDx, lhDy] = offsetFor("left_hip");
  const [rhDx, rhDy] = offsetFor("right_hip");
  const [lkDx, lkDy] = offsetFor("left_knee", poseGainX * 1.8, poseGainY * 1.2);
  const [rkDx, rkDy] = offsetFor("right_knee", poseGainX * 1.8, poseGainY * 1.2);
  const [laDx, laDy] = offsetFor("left_ankle", poseGainX * 1.8, poseGainY * 1.2);
  const [raDx, raDy] = offsetFor("right_ankle", poseGainX * 1.8, poseGainY * 1.2);

  const leftShoulder: V3 = [-SW + lsDx, SHLD_Y + lsDy, 0];
  const rightShoulder: V3 = [SW + rsDx, SHLD_Y + rsDy, 0];
  const leftElbow: V3 = [-SW * eoF + leDx, ELBOW_Y + leDy, efF];
  const rightElbow: V3 = [SW * eoF + reDx, ELBOW_Y + reDy, efF];
  const leftWrist: V3 = [-SW * woF + lwDx, WRIST_Y + lwDy, wfF];
  const rightWrist: V3 = [SW * woF + rwDx, WRIST_Y + rwDy, wfF];

  const leftHip: V3 = [-HW * 0.72 + lhDx, HIP_Y + lhDy, 0];
  const rightHip: V3 = [HW * 0.72 + rhDx, HIP_Y + rhDy, 0];
  const leftKnee: V3 = [-HW * 0.62 + lkDx, KNEE_Y + lkDy, 0.03];
  const rightKnee: V3 = [HW * 0.62 + rkDx, KNEE_Y + rkDy, 0.03];
  const leftAnkle: V3 = [-HW * 0.42 + laDx, ANKLE_Y + laDy, 0];
  const rightAnkle: V3 = [HW * 0.42 + raDx, ANKLE_Y + raDy, 0];

  const torsoTopY = (leftShoulder[1] + rightShoulder[1]) / 2;
  const torsoBottomY = (leftHip[1] + rightHip[1]) / 2;
  const torsoCenterX =
    (leftShoulder[0] + rightShoulder[0] + leftHip[0] + rightHip[0]) / 4;

  // ── Measurement label positions (world space) ─────────────────────────────
  // Positioned just outside body width on each side
  const LABEL_OFFSET = SW * 1.6;

  const labelPositions: Record<string, { pos: V3; bodyEdge: V3; side: "left" | "right" }> = {
    neck: {
      pos: [-LABEL_OFFSET, NECK_Y + 0.02, 0],
      bodyEdge: [headPos[0] - neckR * 2, NECK_Y + 0.02, 0],
      side: "left",
    },
    shoulder: {
      pos: [LABEL_OFFSET, torsoTopY, 0],
      bodyEdge: rightShoulder,
      side: "right",
    },
    upperChest: {
      pos: [-LABEL_OFFSET, torsoTopY - torsoH * 0.18, 0],
      bodyEdge: [torsoCenterX - chestW * 0.92, torsoTopY - torsoH * 0.18, 0],
      side: "left",
    },
    upperArm: {
      pos: [LABEL_OFFSET, (rightShoulder[1] + rightElbow[1]) / 2, 0],
      bodyEdge: rightElbow,
      side: "right",
    },
    waist: {
      pos: [-LABEL_OFFSET, torsoBottomY + torsoH * 0.28, 0],
      bodyEdge: [torsoCenterX - HW * 0.82, torsoBottomY + torsoH * 0.28, 0],
      side: "left",
    },
    hip: {
      pos: [LABEL_OFFSET, torsoBottomY, 0],
      bodyEdge: rightHip,
      side: "right",
    },
    thigh: {
      pos: [-LABEL_OFFSET, (leftHip[1] + leftKnee[1]) / 2, 0],
      bodyEdge: leftKnee,
      side: "left",
    },
    calf: {
      pos: [LABEL_OFFSET, (rightKnee[1] + rightAnkle[1]) / 2, 0],
      bodyEdge: rightAnkle,
      side: "right",
    },
  };

  return (
    <group ref={groupRef} position={[0, 0, 0]}>
      {/* ── Head ── */}
      <mesh position={headPos} castShadow>
        <sphereGeometry args={[HEAD_R, 24, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} transparent opacity={0.85} />
      </mesh>
      <mesh position={headPos}>
        <sphereGeometry args={[HEAD_R * 1.02, 14, 14]} />
        <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.10} />
      </mesh>

      {/* ── Neck ── */}
      <Limb
        from={[headPos[0], CHIN_Y + noseDy * 0.4, 0]}
        to={[torsoCenterX, NECK_Y + (lsDy + rsDy) * 0.5, 0]}
        radius={neckR}
        color={color}
        opacity={0.8}
      />

      {/* ── Torso ── */}
      <group ref={torsoRef}>
        <TorsoSegment
          yB={torsoBottomY + torsoH * 0.4}
          yT={torsoTopY}
          rB={chestW * 0.88}
          rT={chestW}
          dz={torsoDepth * 0.9}
          cx={torsoCenterX}
          color={color}
        />
        <TorsoSegment
          yB={torsoBottomY}
          yT={torsoBottomY + torsoH * 0.4}
          rB={HW * 1.05}
          rT={chestW * 0.88}
          dz={torsoDepth}
          cx={torsoCenterX}
          color={color}
        />
      </group>

      {/* ── Shoulders ── */}
      <Joint pos={leftShoulder} r={SW * 0.14} />
      <Joint pos={rightShoulder} r={SW * 0.14} />

      {/* ── Left arm ── */}
      <Limb from={leftShoulder} to={leftElbow} radius={upperArmR} color={color} />
      <Joint pos={leftElbow} r={upperArmR * 0.75} />
      <Limb from={leftElbow} to={leftWrist} radius={forearmR} color={color} />
      <mesh position={[leftWrist[0], leftWrist[1] - handR, leftWrist[2]]} castShadow>
        <sphereGeometry args={[handR, 10, 10]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent opacity={0.8} />
      </mesh>

      {/* ── Right arm ── */}
      <Limb from={rightShoulder} to={rightElbow} radius={upperArmR} color={color} />
      <Joint pos={rightElbow} r={upperArmR * 0.75} />
      <Limb from={rightElbow} to={rightWrist} radius={forearmR} color={color} />
      <mesh position={[rightWrist[0], rightWrist[1] - handR, rightWrist[2]]} castShadow>
        <sphereGeometry args={[handR, 10, 10]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent opacity={0.8} />
      </mesh>

      {/* ── Hip joints ── */}
      <Joint pos={leftHip} r={HW * 0.22} />
      <Joint pos={rightHip} r={HW * 0.22} />

      {/* ── Left leg ── */}
      <Limb from={leftHip} to={leftKnee} radius={thighR} color={color} />
      <Joint pos={leftKnee} r={thighR * 0.72} />
      <Limb from={leftKnee} to={leftAnkle} radius={shinR} color={color} />
      <Limb
        from={leftAnkle}
        to={[leftAnkle[0], leftAnkle[1], leftAnkle[2] - footR * 2.5]}
        radius={footR}
        color={color}
        opacity={0.75}
      />

      {/* ── Right leg ── */}
      <Limb from={rightHip} to={rightKnee} radius={thighR} color={color} />
      <Joint pos={rightKnee} r={thighR * 0.72} />
      <Limb from={rightKnee} to={rightAnkle} radius={shinR} color={color} />
      <Limb
        from={rightAnkle}
        to={[rightAnkle[0], rightAnkle[1], rightAnkle[2] - footR * 2.5]}
        radius={footR}
        color={color}
        opacity={0.75}
      />

      {/* ── Ground shadow ── */}
      <mesh rotation={[-Math.PI/2, 0, 0]} position={[0, FOOT_Y - 0.01, 0]} receiveShadow>
        <circleGeometry args={[0.45, 32]} />
        <meshStandardMaterial color="#0c4a6e" transparent opacity={0.35} depthWrite={false} />
      </mesh>

      {/* ── Measurement label overlays ── */}
      {MEASUREMENT_ORDER.map(({ key, label, side }) => {
        const val = measurements[key];
        const lp = labelPositions[key];
        if (!lp || val === undefined) return null;
        return (
          <group key={key}>
            <ConnectorLine from={lp.bodyEdge} to={lp.pos} />
            <MeasurementLabel position={lp.pos} label={label} value={val} side={side} />
          </group>
        );
      })}

      <ScanRing bodyBottom={FOOT_Y} bodyTop={HEAD_Y + HEAD_R} />
    </group>
  );
}

// ─── Root component ───────────────────────────────────────────────────────────
export default function Body3DViewer({
  keypoints,
  keypointSequence,
  dominantMotionHz,
  breathingHz,
  minHeight = "clamp(460px, 62vh, 860px)",
  bodyMetrics,
  bodyFatPercent,
  classification,
  measurements,
}: Props) {
  const color = fatHex(bodyFatPercent);
  const [spinning, setSpinning] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);

  const playbackFps = useMemo(() => {
    if (keypointSequence && keypointSequence.length > 1) {
      const dt = keypointSequence[1].t - keypointSequence[0].t;
      if (dt > 0) return Math.min(20, Math.max(5, 1 / dt));
    }
    return 10;
  }, [keypointSequence]);

  useEffect(() => {
    if (!keypointSequence || keypointSequence.length < 2) return;
    const intervalMs = Math.max(40, Math.round(1000 / playbackFps));
    const timer = setInterval(() => {
      setFrameIndex((idx) => (idx + 1) % keypointSequence.length);
    }, intervalMs);
    return () => clearInterval(timer);
  }, [keypointSequence, playbackFps]);

  const activeKeypoints = useMemo(() => {
    if (keypointSequence && keypointSequence.length > 0) {
      return keypointSequence[frameIndex % keypointSequence.length].keypoints;
    }
    return keypoints;
  }, [keypointSequence, frameIndex, keypoints]);

  const replayLabel =
    keypointSequence && keypointSequence.length > 1
      ? `Replay ${frameIndex + 1}/${keypointSequence.length}`
      : "Static pose";

  return (
    <div style={{
      width: "100%",
      height: "100%",
      minHeight: typeof minHeight === "number" ? `${minHeight}px` : minHeight,
      background: "#0d1117", borderRadius: "0.625rem 0.625rem 0 0",
      overflow: "hidden", position: "relative",
    }}>
      {/* Body-fat badge */}
      <div style={{
        position: "absolute", top: 10, left: 12, zIndex: 10,
        fontSize: "0.63rem", fontWeight: 700, letterSpacing: "0.07em",
        textTransform: "uppercase", color: "#8b95a3", userSelect: "none", pointerEvents: "none",
      }}>
        RF Body Mesh · {replayLabel}
      </div>

      {dominantMotionHz && (
        <div style={{
          position: "absolute", top: 34, left: 12, zIndex: 10,
          fontSize: "0.58rem", fontWeight: 600, letterSpacing: "0.05em",
          color: "#7dd3fc", background: "rgba(34,211,238,0.08)",
          border: "1px solid rgba(34,211,238,0.25)",
          borderRadius: "0.25rem", padding: "1px 7px",
          userSelect: "none", pointerEvents: "none",
        }}>
          motion {dominantMotionHz.toFixed(2)} Hz
        </div>
      )}

      {keypointSequence && keypointSequence.length > 1 && (
        <div style={{
          position: "absolute", top: 58, left: 12, zIndex: 10,
          fontSize: "0.58rem", fontWeight: 600, letterSpacing: "0.04em",
          color: "#94a3b8", background: "rgba(148,163,184,0.08)",
          border: "1px solid rgba(148,163,184,0.18)",
          borderRadius: "0.25rem", padding: "1px 7px",
          userSelect: "none", pointerEvents: "none",
        }}>
          {playbackFps.toFixed(1)} fps playback
        </div>
      )}

      {breathingHz && breathingHz > 0 && (
        <div style={{
          position: "absolute", top: 82, left: 12, zIndex: 10,
          fontSize: "0.56rem", fontWeight: 600, letterSpacing: "0.04em",
          color: "#67e8f9", background: "rgba(103,232,249,0.08)",
          border: "1px solid rgba(103,232,249,0.2)",
          borderRadius: "0.25rem", padding: "1px 7px",
          userSelect: "none", pointerEvents: "none",
        }}>
          breathing {breathingHz.toFixed(2)} Hz
        </div>
      )}

      {!spinning && (
        <div style={{
          position: "absolute", top: 10, right: 122, zIndex: 10,
          fontSize: "0.56rem", fontWeight: 600, letterSpacing: "0.04em",
          color: "#94a3b8", background: "rgba(148,163,184,0.08)",
          border: "1px solid rgba(148,163,184,0.2)",
          borderRadius: "0.25rem", padding: "1px 7px",
          userSelect: "none", pointerEvents: "none",
        }}>
          auto-spin paused
        </div>
      )}
      <div style={{
        position: "absolute", top: 10, right: 12, zIndex: 10,
        fontSize: "0.65rem", fontWeight: 700, letterSpacing: "0.06em",
        color, background: `${color}18`, border: `1px solid ${color}40`,
        borderRadius: "0.25rem", padding: "1px 7px",
        userSelect: "none", pointerEvents: "none",
      }}>
        {bodyFatPercent}% · {classification}
      </div>

      {/* Rotate hint */}
      <div style={{
        position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)",
        zIndex: 10, fontSize: "0.58rem", color: "#535f6d",
        userSelect: "none", pointerEvents: "none",
      }}>
        Drag to rotate · Scroll to zoom
      </div>

      <Canvas
        shadows
        camera={{ position: [0, 0, 4.2], fov: 36 }}
        gl={{
          antialias: true, alpha: false,
          powerPreference: "high-performance",
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.1,
        }}
        style={{ background: "#0d1117" }}
        onPointerDown={() => { setSpinning(false); }}
      >
        <ambientLight intensity={0.28} color="#c8d8f0" />
        <directionalLight position={[2, 5, 3]} intensity={1.8} color="#e8f4ff" castShadow
          shadow-mapSize={[1024, 1024]} />
        <directionalLight position={[-2, 3, -2]} intensity={0.4} color="#38bdf8" />
        <pointLight position={[0, -0.5, 2]} intensity={0.5} color="#0ea5e9" distance={5} />

        <HumanBody
          bodyMetrics={bodyMetrics}
          bodyFatPercent={bodyFatPercent}
          measurements={measurements}
          spinning={spinning}
          poseKeypoints={activeKeypoints}
          breathingHz={breathingHz}
        />

        <OrbitControls
          enablePan={false}
          enableZoom={true}
          minDistance={2}
          maxDistance={6}
          minPolarAngle={Math.PI * 0.1}
          maxPolarAngle={Math.PI * 0.88}
          makeDefault
        />
      </Canvas>
    </div>
  );
}
