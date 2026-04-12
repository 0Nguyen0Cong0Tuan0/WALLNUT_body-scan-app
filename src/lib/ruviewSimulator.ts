/**
 * RuView WiFi DensePose Simulator
 *
 * Simulates an ESP32-S3 CSI sensing output stream when no hardware is available.
 * Provides both:
 *   - a single frame snapshot
 *   - a temporal keypoint sequence for motion playback
 */

export type SimulatedActivity = "standing" | "walking" | "sitting" | "fallen";

export interface Keypoint {
  point: string;
  x: number;
  y: number;
  z: number;
  confidence: number;
}

export interface VitalSigns {
  heartRate: number; // bpm (40-120)
  breathingRate: number; // breaths/min (6-30)
  hrv: number; // ms
}

export interface BodyMetrics {
  estimatedHeightCm: number;
  shoulderWidthCm: number;
  hipWidthCm: number;
  torsoLengthCm: number;
  leftArmLengthCm: number;
  rightArmLengthCm: number;
  leftLegLengthCm: number;
  bmi_proxy: number;
}

export interface RuViewFrame {
  timestamp: number;
  nodeId: string;
  channel: number;
  subcarriers: number;
  rssi: number;
  keypoints: Keypoint[];
  vitals: VitalSigns;
  bodyMetrics: BodyMetrics;
}

export interface SimulatedTemporalFrame {
  t: number;
  keypoints: Keypoint[];
  confidence: number;
  motionScore: number;
}

export interface SimulatedTemporalData {
  activity: SimulatedActivity;
  activityConfidence: number;
  dominantMotionHz: number;
  breathingHz: number;
  fps: number;
  durationSeconds: number;
  sequence: SimulatedTemporalFrame[];
}

// 17 COCO keypoint names in order
export const COCO_KEYPOINTS = [
  "nose",
  "left_eye",
  "right_eye",
  "left_ear",
  "right_ear",
  "left_shoulder",
  "right_shoulder",
  "left_elbow",
  "right_elbow",
  "left_wrist",
  "right_wrist",
  "left_hip",
  "right_hip",
  "left_knee",
  "right_knee",
  "left_ankle",
  "right_ankle",
] as const;

// Canonical standing pose (normalized 0-1 coords)
const CANONICAL_POSE: Record<string, [number, number]> = {
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

const ACTIVITY_MOTION_HZ: Record<SimulatedActivity, number> = {
  standing: 0.30,
  walking: 1.20,
  sitting: 0.25,
  fallen: 0.15,
};

const ACTIVITY_RSSI: Record<SimulatedActivity, number> = {
  standing: -62,
  walking: -58,
  sitting: -67,
  fallen: -70,
};

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function jitter(base: number, amount: number): number {
  return base + (Math.random() - 0.5) * amount;
}

function applyActivityPosture(baseKeypoints: Keypoint[], activity: SimulatedActivity): Keypoint[] {
  const out = baseKeypoints.map((keypoint) => ({ ...keypoint }));
  const mutate = (pointName: string, dx: number, dy: number, confidenceScale = 1): void => {
    const point = out.find((kp) => kp.point === pointName);
    if (!point) return;
    point.x += dx;
    point.y += dy;
    point.confidence = clamp(point.confidence * confidenceScale, 0.45, 0.99);
  };

  if (activity === "sitting") {
    mutate("left_hip", -0.02, 0.06);
    mutate("right_hip", 0.02, 0.06);
    mutate("left_knee", -0.03, -0.05);
    mutate("right_knee", 0.03, -0.05);
    mutate("left_ankle", -0.07, -0.12);
    mutate("right_ankle", 0.07, -0.12);
    mutate("left_wrist", 0.08, 0.02);
    mutate("right_wrist", -0.08, 0.02);
    mutate("nose", 0.00, 0.015);
  }

  if (activity === "fallen") {
    const setAbs = (pointName: string, x: number, y: number, confidence = 0.8): void => {
      const point = out.find((kp) => kp.point === pointName);
      if (!point) return;
      point.x = x;
      point.y = y;
      point.confidence = confidence;
    };
    const cx = 0.5;
    const cy = 0.78;
    const span = 0.56;

    setAbs("nose", cx - span * 0.45, cy - 0.03, 0.80);
    setAbs("left_eye", cx - span * 0.47, cy - 0.04, 0.78);
    setAbs("right_eye", cx - span * 0.43, cy - 0.02, 0.78);
    setAbs("left_ear", cx - span * 0.49, cy - 0.01, 0.75);
    setAbs("right_ear", cx - span * 0.41, cy + 0.01, 0.75);

    setAbs("left_shoulder", cx - span * 0.28, cy - 0.045, 0.84);
    setAbs("right_shoulder", cx - span * 0.28, cy + 0.045, 0.84);
    setAbs("left_elbow", cx - span * 0.12, cy - 0.055, 0.76);
    setAbs("right_elbow", cx - span * 0.12, cy + 0.055, 0.76);
    setAbs("left_wrist", cx + span * 0.02, cy - 0.06, 0.70);
    setAbs("right_wrist", cx + span * 0.02, cy + 0.06, 0.70);

    setAbs("left_hip", cx + span * 0.08, cy - 0.040, 0.83);
    setAbs("right_hip", cx + span * 0.08, cy + 0.040, 0.83);
    setAbs("left_knee", cx + span * 0.25, cy - 0.045, 0.78);
    setAbs("right_knee", cx + span * 0.25, cy + 0.045, 0.78);
    setAbs("left_ankle", cx + span * 0.42, cy - 0.035, 0.74);
    setAbs("right_ankle", cx + span * 0.42, cy + 0.035, 0.74);
  }

  return out.map((point) => ({
    ...point,
    x: clamp(point.x, 0.03, 0.97),
    y: clamp(point.y, 0.02, 0.98),
  }));
}

function generateKeypoints(activity: SimulatedActivity): Keypoint[] {
  const standingBase = COCO_KEYPOINTS.map((name) => {
    const [baseX, baseY] = CANONICAL_POSE[name];
    return {
      point: name,
      x: jitter(baseX, 0.015),
      y: jitter(baseY, 0.015),
      z: jitter(0.5, 0.05),
      confidence: 0.82 + Math.random() * 0.17,
    };
  });
  return applyActivityPosture(standingBase, activity);
}

function generateVitals(activity: SimulatedActivity): VitalSigns {
  const base: Record<SimulatedActivity, { hr: number; rr: number; hrv: number }> = {
    standing: { hr: 72, rr: 14, hrv: 42 },
    walking: { hr: 98, rr: 20, hrv: 28 },
    sitting: { hr: 68, rr: 12, hrv: 48 },
    fallen: { hr: 60, rr: 10, hrv: 24 },
  };
  const profile = base[activity];
  return {
    heartRate: Math.round(jitter(profile.hr, activity === "walking" ? 10 : 6)),
    breathingRate: Math.round(jitter(profile.rr, activity === "walking" ? 4 : 3)),
    hrv: Math.round(jitter(profile.hrv, activity === "walking" ? 8 : 10)),
  };
}

/**
 * Convert 17 COCO keypoints to rough cm-scale body metrics.
 */
function computeBodyMetrics(keypoints: Keypoint[], refHeightCm = 170): BodyMetrics {
  const kp = Object.fromEntries(keypoints.map((point) => [point.point, point])) as Record<
    string,
    Keypoint
  >;
  const normDist = (a: string, b: string): number => {
    if (!kp[a] || !kp[b]) return 0;
    const dx = kp[a].x - kp[b].x;
    const dy = kp[a].y - kp[b].y;
    return Math.sqrt(dx * dx + dy * dy);
  };

  // Orientation-invariant body axis: avoids oversize artifacts in fallen/horizontal poses.
  const bodyAxisNorm = clamp(
    (normDist("nose", "left_ankle") + normDist("nose", "right_ankle")) / 2 || 0.86,
    0.55,
    1.15
  );
  const scale = refHeightCm / bodyAxisNorm;

  const shoulderWidthCm = Math.round(
    clamp(normDist("left_shoulder", "right_shoulder") * scale, 30, 62)
  );
  const hipWidthCm = Math.round(clamp(normDist("left_hip", "right_hip") * scale, 28, 62));
  const torsoLengthCm = Math.round(
    clamp(normDist("left_shoulder", "left_hip") * scale * 1.05, 36, 82)
  );
  const leftArmLengthCm = Math.round(
    clamp(
      (normDist("left_shoulder", "left_elbow") + normDist("left_elbow", "left_wrist")) * scale,
      42,
      92
    )
  );
  const rightArmLengthCm = Math.round(
    clamp(
      (normDist("right_shoulder", "right_elbow") + normDist("right_elbow", "right_wrist")) * scale,
      42,
      92
    )
  );
  const leftLegLengthCm = Math.round(
    clamp((normDist("left_hip", "left_knee") + normDist("left_knee", "left_ankle")) * scale, 58, 128)
  );

  return {
    estimatedHeightCm: Math.round(clamp(jitter(refHeightCm, 4), 150, 198)),
    shoulderWidthCm,
    hipWidthCm,
    torsoLengthCm,
    leftArmLengthCm,
    rightArmLengthCm,
    leftLegLengthCm,
    bmi_proxy: parseFloat(clamp(shoulderWidthCm / Math.max(hipWidthCm, 1), 0.72, 1.48).toFixed(2)),
  };
}

function applyTemporalMotion(
  base: Keypoint[],
  activity: SimulatedActivity,
  t: number,
  motionHz: number,
  breathingHz: number
): Keypoint[] {
  const out = base.map((keypoint) => ({ ...keypoint }));
  const motionPhase = 2 * Math.PI * motionHz * t;
  const breathPhase = 2 * Math.PI * breathingHz * t;

  const mutate = (pointName: string, dx: number, dy: number, confidenceScale = 1): void => {
    const point = out.find((kp) => kp.point === pointName);
    if (!point) return;
    point.x += dx;
    point.y += dy;
    point.confidence = clamp(point.confidence * confidenceScale, 0.45, 0.99);
  };

  const breathingLift = 0.008 * Math.sin(breathPhase);
  ["nose", "left_eye", "right_eye", "left_ear", "right_ear"].forEach((pointName) =>
    mutate(pointName, 0, -breathingLift, 1.005)
  );
  ["left_shoulder", "right_shoulder", "left_hip", "right_hip"].forEach((pointName) =>
    mutate(pointName, 0, -breathingLift * 0.6, 1.0)
  );

  if (activity === "walking") {
    const step = Math.sin(motionPhase);
    const antiStep = Math.sin(motionPhase + Math.PI);
    const stride = 0.032;
    const legLift = 0.028;
    const armSwing = 0.040;

    mutate("left_knee", -stride * step, -legLift * Math.max(0, step), 0.98);
    mutate("right_knee", -stride * antiStep, -legLift * Math.max(0, antiStep), 0.98);
    mutate("left_ankle", -stride * 1.2 * step, -legLift * 0.65 * Math.max(0, step), 0.97);
    mutate("right_ankle", -stride * 1.2 * antiStep, -legLift * 0.65 * Math.max(0, antiStep), 0.97);
    mutate("left_elbow", armSwing * antiStep, 0.01 * Math.abs(antiStep), 0.99);
    mutate("right_elbow", -armSwing * antiStep, 0.01 * Math.abs(antiStep), 0.99);
    mutate("left_wrist", armSwing * 1.25 * antiStep, 0.02 * Math.abs(antiStep), 0.98);
    mutate("right_wrist", -armSwing * 1.25 * antiStep, 0.02 * Math.abs(antiStep), 0.98);
  } else if (activity === "standing") {
    const sway = 0.012 * Math.sin(motionPhase * 0.7);
    mutate("left_wrist", sway, 0, 0.99);
    mutate("right_wrist", -sway, 0, 0.99);
    mutate("left_ankle", 0.004 * Math.sin(motionPhase * 0.5), 0, 0.99);
    mutate("right_ankle", -0.004 * Math.sin(motionPhase * 0.5), 0, 0.99);
  } else if (activity === "sitting") {
    const torsoBob = 0.006 * Math.sin(motionPhase * 0.8);
    mutate("nose", 0, torsoBob, 1.0);
    mutate("left_shoulder", 0, torsoBob, 1.0);
    mutate("right_shoulder", 0, torsoBob, 1.0);
  } else if (activity === "fallen") {
    const drift = 0.004 * Math.sin(motionPhase * 0.2);
    out.forEach((point) => {
      point.x = clamp(point.x + drift, 0.03, 0.97);
    });
  }

  return out.map((point) => ({
    ...point,
    x: clamp(point.x, 0.03, 0.97),
    y: clamp(point.y, 0.02, 0.98),
  }));
}

/** Generate one simulated frame (snapshot). */
export function generateRuViewFrame(activity: SimulatedActivity = "standing"): RuViewFrame {
  const keypoints = generateKeypoints(activity);
  const vitals = generateVitals(activity);
  const bodyMetrics = computeBodyMetrics(keypoints);

  return {
    timestamp: Date.now(),
    nodeId: "ESP32-SIM-01",
    channel: 11,
    subcarriers: 56,
    rssi: Math.round(jitter(ACTIVITY_RSSI[activity], 6)),
    keypoints,
    vitals,
    bodyMetrics,
  };
}

/** Generate a time sequence to animate activity-level replay in the 3D UI. */
export function generateRuViewTemporalSequence(
  baseKeypoints: Keypoint[],
  options?: { activity?: SimulatedActivity; durationSeconds?: number; fps?: number }
): SimulatedTemporalData {
  const activity = options?.activity ?? "standing";
  const durationSeconds = options?.durationSeconds ?? 12;
  const fps = options?.fps ?? 12;
  const breathingHz = activity === "walking" ? 0.34 : 0.25;
  const dominantMotionHz = ACTIVITY_MOTION_HZ[activity];

  const frameCount = Math.max(1, Math.round(durationSeconds * fps));
  const sequence: SimulatedTemporalFrame[] = [];

  for (let i = 0; i < frameCount; i++) {
    const t = i / fps;
    const keypoints = applyTemporalMotion(baseKeypoints, activity, t, dominantMotionHz, breathingHz);
    const motionScore = activity === "walking" ? 1.35 : activity === "fallen" ? 0.25 : 0.65;
    sequence.push({
      t,
      keypoints,
      confidence: clamp(0.72 + (activity === "walking" ? 0.08 : 0), 0.72, 0.92),
      motionScore,
    });
  }

  return {
    activity,
    activityConfidence: 0.90,
    dominantMotionHz,
    breathingHz,
    fps,
    durationSeconds,
    sequence,
  };
}

