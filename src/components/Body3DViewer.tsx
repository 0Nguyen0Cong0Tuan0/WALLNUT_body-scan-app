"use client";

import { useRef, useMemo } from "react";
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

interface Props {
  keypoints?: unknown[];
  bodyMetrics: BodyMetrics;
  bodyFatPercent: number;
  classification: string;
  measurements: BodyCircumferences;
}

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
function TorsoSegment({ yB, yT, rB, rT, dz, color, opacity = 0.80 }: {
  yB: number; yT: number; rB: number; rT: number; dz: number;
  color: string; opacity?: number;
}) {
  const h = yT - yB;
  const cy = yB + h / 2;
  return (
    <group position={[0, cy, 0]} scale={[1, 1, dz]}>
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
  bodyMetrics, bodyFatPercent, measurements, spinning,
}: {
  bodyMetrics: BodyMetrics;
  bodyFatPercent: number;
  measurements: BodyCircumferences;
  spinning: boolean;
}) {
  const groupRef = useRef<THREE.Group>(null!);
  useFrame((_, delta) => {
    if (spinning) groupRef.current.rotation.y += delta * 0.28;
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

  const eoF = 1.05; const efF = 0.08;
  const woF = 1.12; const wfF = 0.14;

  // ── Measurement label positions (world space) ─────────────────────────────
  // Positioned just outside body width on each side
  const LABEL_OFFSET = SW * 1.6;
  type V3 = [number,number,number];

  const labelPositions: Record<string, { pos: V3; bodyEdge: V3; side: "left"|"right" }> = {
    neck:       { pos: [-LABEL_OFFSET, NECK_Y + 0.02, 0],   bodyEdge: [-neckR * 2, NECK_Y + 0.02, 0],           side: "left" },
    shoulder:   { pos: [LABEL_OFFSET,  SHLD_Y,        0],   bodyEdge: [SW,         SHLD_Y,         0],           side: "right" },
    upperChest: { pos: [-LABEL_OFFSET, SHLD_Y - torsoH*0.18, 0], bodyEdge: [-chestW * 0.92, SHLD_Y - torsoH*0.18, 0], side: "left" },
    upperArm:   { pos: [LABEL_OFFSET,  ELBOW_Y + upperArmH*0.5, 0], bodyEdge: [SW * eoF, ELBOW_Y + upperArmH*0.5, 0], side: "right" },
    waist:      { pos: [-LABEL_OFFSET, HIP_Y + torsoH*0.28, 0], bodyEdge: [-HW * 0.82, HIP_Y + torsoH*0.28, 0], side: "left" },
    hip:        { pos: [LABEL_OFFSET,  HIP_Y,               0], bodyEdge: [HW,          HIP_Y,               0], side: "right" },
    thigh:      { pos: [-LABEL_OFFSET, KNEE_Y + thighH*0.5, 0], bodyEdge: [-HW * 0.72, KNEE_Y + thighH*0.5,  0], side: "left" },
    calf:       { pos: [LABEL_OFFSET,  ANKLE_Y + shinH*0.48, 0], bodyEdge: [HW * 0.45, ANKLE_Y + shinH*0.48,  0], side: "right" },
  };

  return (
    <group ref={groupRef}>
      {/* ── Head ── */}
      <mesh position={[0, HEAD_Y, 0]} castShadow>
        <sphereGeometry args={[HEAD_R, 24, 24]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.05} transparent opacity={0.85} />
      </mesh>
      <mesh position={[0, HEAD_Y, 0]}>
        <sphereGeometry args={[HEAD_R * 1.02, 14, 14]} />
        <meshBasicMaterial color="#22d3ee" wireframe transparent opacity={0.10} />
      </mesh>

      {/* ── Neck ── */}
      <Limb from={[0, CHIN_Y, 0]} to={[0, NECK_Y, 0]} radius={neckR} color={color} opacity={0.8} />

      {/* ── Torso ── */}
      <TorsoSegment yB={HIP_Y + torsoH*0.4} yT={SHLD_Y}   rB={chestW*0.88} rT={chestW}    dz={torsoDepth*0.9} color={color} />
      <TorsoSegment yB={HIP_Y}              yT={HIP_Y + torsoH*0.4} rB={HW*1.05} rT={chestW*0.88} dz={torsoDepth} color={color} />

      {/* ── Shoulders ── */}
      <Joint pos={[-SW, SHLD_Y, 0]} r={SW * 0.14} />
      <Joint pos={[SW,  SHLD_Y, 0]} r={SW * 0.14} />

      {/* ── Left arm ── */}
      <Limb from={[-SW, SHLD_Y, 0]} to={[-SW*eoF, ELBOW_Y, efF]} radius={upperArmR} color={color} />
      <Joint pos={[-SW*eoF, ELBOW_Y, efF] as V3} r={upperArmR*0.75} />
      <Limb from={[-SW*eoF, ELBOW_Y, efF]} to={[-SW*woF, WRIST_Y, wfF]} radius={forearmR} color={color} />
      <mesh position={[-SW*woF, WRIST_Y - handR, wfF]} castShadow>
        <sphereGeometry args={[handR, 10, 10]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent opacity={0.8} />
      </mesh>

      {/* ── Right arm ── */}
      <Limb from={[SW, SHLD_Y, 0]} to={[SW*eoF, ELBOW_Y, efF]} radius={upperArmR} color={color} />
      <Joint pos={[SW*eoF, ELBOW_Y, efF] as V3} r={upperArmR*0.75} />
      <Limb from={[SW*eoF, ELBOW_Y, efF]} to={[SW*woF, WRIST_Y, wfF]} radius={forearmR} color={color} />
      <mesh position={[SW*woF, WRIST_Y - handR, wfF]} castShadow>
        <sphereGeometry args={[handR, 10, 10]} />
        <meshStandardMaterial color={color} roughness={0.5} transparent opacity={0.8} />
      </mesh>

      {/* ── Hip joints ── */}
      <Joint pos={[-HW*0.72, HIP_Y, 0]} r={HW*0.22} />
      <Joint pos={[HW*0.72,  HIP_Y, 0]} r={HW*0.22} />

      {/* ── Left leg ── */}
      <Limb from={[-HW*0.72, HIP_Y, 0]}   to={[-HW*0.62, KNEE_Y, 0.03]}  radius={thighR} color={color} />
      <Joint pos={[-HW*0.62, KNEE_Y, 0.03]} r={thighR*0.72} />
      <Limb from={[-HW*0.62, KNEE_Y, 0.03]} to={[-HW*0.42, ANKLE_Y, 0]}  radius={shinR}  color={color} />
      <Limb from={[-HW*0.42, ANKLE_Y, 0]} to={[-HW*0.42, ANKLE_Y, -footR*2.5]} radius={footR} color={color} opacity={0.75} />

      {/* ── Right leg ── */}
      <Limb from={[HW*0.72, HIP_Y, 0]}   to={[HW*0.62, KNEE_Y, 0.03]}  radius={thighR} color={color} />
      <Joint pos={[HW*0.62, KNEE_Y, 0.03]} r={thighR*0.72} />
      <Limb from={[HW*0.62, KNEE_Y, 0.03]} to={[HW*0.42, ANKLE_Y, 0]}   radius={shinR}  color={color} />
      <Limb from={[HW*0.42, ANKLE_Y, 0]} to={[HW*0.42, ANKLE_Y, -footR*2.5]} radius={footR} color={color} opacity={0.75} />

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
  bodyMetrics, bodyFatPercent, classification, measurements,
}: Props) {
  const color = fatHex(bodyFatPercent);
  // Stop auto-spin when user interacts — done via OrbitControls event
  const spinning = useRef(true);

  return (
    <div style={{
      width: "100%", height: "100%", minHeight: 480,
      background: "#0d1117", borderRadius: "0.625rem 0.625rem 0 0",
      overflow: "hidden", position: "relative",
    }}>
      {/* Body-fat badge */}
      <div style={{
        position: "absolute", top: 10, left: 12, zIndex: 10,
        fontSize: "0.63rem", fontWeight: 700, letterSpacing: "0.07em",
        textTransform: "uppercase", color: "#8b95a3", userSelect: "none", pointerEvents: "none",
      }}>
        RF Body Mesh · SMPL-fit
      </div>
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
        onPointerDown={() => { spinning.current = false; }}
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
          spinning={spinning.current}
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
