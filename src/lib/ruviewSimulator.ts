/**
 * RuView WiFi DensePose Simulator
 *
 * Simulates the output of a real ESP32-S3 CSI sensing pipeline.
 * In a production deployment, this module is replaced by the actual RuView
 * docker process streaming over UDP/WebSocket.
 *
 * Reference: ruvnet/RuView — WiFi DensePose (simulated mode)
 */

export interface Keypoint {
  point: string;
  x: number;
  y: number;
  z: number;
  confidence: number;
}

export interface VitalSigns {
  heartRate: number;     // bpm (40–120)
  breathingRate: number; // breaths/min (6–30)
  hrv: number;           // heart rate variability ms
}

export interface BodyMetrics {
  estimatedHeightCm: number;
  shoulderWidthCm: number;
  hipWidthCm: number;
  torsoLengthCm: number;
  leftArmLengthCm: number;
  rightArmLengthCm: number;
  leftLegLengthCm: number;
  bmi_proxy: number;    // shoulder-to-hip ratio (proxy metric)
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

// 17 COCO keypoint names in order
export const COCO_KEYPOINTS = [
  "nose", "left_eye", "right_eye", "left_ear", "right_ear",
  "left_shoulder", "right_shoulder", "left_elbow", "right_elbow",
  "left_wrist", "right_wrist", "left_hip", "right_hip",
  "left_knee", "right_knee", "left_ankle", "right_ankle",
];

// Canonical standing pose (normalized 0-1 coords, y=0 is top)
const CANONICAL_POSE: Record<string, [number, number]> = {
  nose:           [0.50, 0.06],
  left_eye:       [0.47, 0.04],
  right_eye:      [0.53, 0.04],
  left_ear:       [0.44, 0.05],
  right_ear:      [0.56, 0.05],
  left_shoulder:  [0.38, 0.20],
  right_shoulder: [0.62, 0.20],
  left_elbow:     [0.30, 0.38],
  right_elbow:    [0.70, 0.38],
  left_wrist:     [0.25, 0.54],
  right_wrist:    [0.75, 0.54],
  left_hip:       [0.42, 0.52],
  right_hip:      [0.58, 0.52],
  left_knee:      [0.40, 0.72],
  right_knee:     [0.60, 0.72],
  left_ankle:     [0.40, 0.92],
  right_ankle:    [0.60, 0.92],
};

function jitter(base: number, amount: number): number {
  return base + (Math.random() - 0.5) * amount;
}

function generateKeypoints(): Keypoint[] {
  return COCO_KEYPOINTS.map((name) => {
    const [bx, by] = CANONICAL_POSE[name];
    return {
      point: name,
      x: jitter(bx, 0.015),
      y: jitter(by, 0.015),
      z: jitter(0.5, 0.05),
      confidence: 0.82 + Math.random() * 0.17,
    };
  });
}

function generateVitals(): VitalSigns {
  return {
    heartRate: Math.round(jitter(72, 10)),
    breathingRate: Math.round(jitter(14, 4)),
    hrv: Math.round(jitter(42, 12)),
  };
}

/**
 * Convert 17 COCO keypoints back to cm-scale body metrics.
 * Uses the reference height passed in, or defaults to 170 cm for scale.
 */
function computeBodyMetrics(keypoints: Keypoint[], refHeightCm = 170): BodyMetrics {
  const kp = Object.fromEntries(keypoints.map((k) => [k.point, k]));

  const pixelHeight = (kp["nose"].y - kp["left_ankle"].y) * -1 || 0.86;
  const scale = refHeightCm / Math.abs(pixelHeight || 0.86);

  const dist = (a: string, b: string) => {
    const dx = (kp[a].x - kp[b].x) * scale;
    const dy = (kp[a].y - kp[b].y) * scale;
    return Math.sqrt(dx * dx + dy * dy);
  };

  return {
    estimatedHeightCm: Math.round(jitter(170, 5)),
    shoulderWidthCm: Math.round(dist("left_shoulder", "right_shoulder")),
    hipWidthCm: Math.round(dist("left_hip", "right_hip")),
    torsoLengthCm: Math.round(dist("left_shoulder", "left_hip") * 1.05),
    leftArmLengthCm: Math.round(dist("left_shoulder", "left_elbow") + dist("left_elbow", "left_wrist")),
    rightArmLengthCm: Math.round(dist("right_shoulder", "right_elbow") + dist("right_elbow", "right_wrist")),
    leftLegLengthCm: Math.round(dist("left_hip", "left_knee") + dist("left_knee", "left_ankle")),
    bmi_proxy: parseFloat((dist("left_shoulder", "right_shoulder") / dist("left_hip", "right_hip")).toFixed(2)),
  };
}

/** Generate a single simulated RuView frame (as if streamed from hardware) */
export function generateRuViewFrame(): RuViewFrame {
  const keypoints = generateKeypoints();
  const vitals = generateVitals();
  const bodyMetrics = computeBodyMetrics(keypoints);

  return {
    timestamp: Date.now(),
    nodeId: "ESP32-SIM-01",
    channel: 11,
    subcarriers: 56,
    rssi: Math.round(jitter(-62, 6)),
    keypoints,
    vitals,
    bodyMetrics,
  };
}
