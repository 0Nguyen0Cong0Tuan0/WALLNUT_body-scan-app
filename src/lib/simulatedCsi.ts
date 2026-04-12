import type { ParsedCSI } from "@/lib/csiProcessor";
import type { SimulatedActivity } from "@/lib/ruviewSimulator";

const DEFAULT_ACTIVITY_SET: SimulatedActivity[] = ["standing", "walking", "sitting", "fallen"];

const BREATHING_HZ: Record<SimulatedActivity, number> = {
  standing: 0.24,
  walking: 0.33,
  sitting: 0.20,
  fallen: 0.16,
};

const HEART_HZ: Record<SimulatedActivity, number> = {
  standing: 1.15,
  walking: 1.58,
  sitting: 1.05,
  fallen: 0.92,
};

const MOTION_HZ: Record<SimulatedActivity, number> = {
  standing: 0.22,
  walking: 1.20,
  sitting: 0.18,
  fallen: 0.06,
};

const MOTION_AMP: Record<SimulatedActivity, number> = {
  standing: 0.03,
  walking: 0.13,
  sitting: 0.02,
  fallen: 0.01,
};

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function chooseActivity(activity?: SimulatedActivity): SimulatedActivity {
  if (activity) return activity;
  const index = Math.floor(Math.random() * DEFAULT_ACTIVITY_SET.length);
  return DEFAULT_ACTIVITY_SET[index];
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function generateSimulatedParsedCsi(activityOverride?: SimulatedActivity): {
  parsed: ParsedCSI;
  activity: SimulatedActivity;
} {
  const activity = chooseActivity(activityOverride);
  const sampleRateHz = 100;
  const durationSeconds = 6;
  const numFrames = sampleRateHz * durationSeconds;
  const numSubcarriers = 56;
  const numAntennas = 1;
  const nodeId = 999;

  const breathingHz = BREATHING_HZ[activity];
  const heartHz = HEART_HZ[activity];
  const motionHz = MOTION_HZ[activity];
  const motionAmp = MOTION_AMP[activity];

  const timestampsSeconds: number[] = [];
  const amplitudeMatrix: number[][] = [];
  const phaseMatrix: number[][] = [];
  const amplitudeTimeseries: number[] = [];
  const rssiTimeseries: number[] = [];

  for (let i = 0; i < numFrames; i++) {
    const t = i / sampleRateHz;
    timestampsSeconds.push(round(t, 4));

    const breathing = 0.09 * Math.sin(2 * Math.PI * breathingHz * t);
    const heartbeat = 0.03 * Math.sin(2 * Math.PI * heartHz * t + 0.3);
    const motion = motionAmp * Math.sin(2 * Math.PI * motionHz * t);
    const base = 1.12 + breathing + heartbeat + motion;

    const row: number[] = [];
    const phaseRow: number[] = [];
    for (let s = 0; s < numSubcarriers; s++) {
      const subNorm = s / Math.max(1, numSubcarriers - 1);
      const spatialCarrier = 0.07 * Math.sin(2 * Math.PI * subNorm + motion * 2.2);
      const harmonic = 0.02 * Math.sin(2 * Math.PI * (subNorm * 3.5 + t * 0.8));
      const amplitude = Math.max(0.08, base + spatialCarrier + harmonic);
      row.push(round(amplitude));

      const phase = Math.atan2(
        Math.sin(2 * Math.PI * (0.18 * subNorm + t * breathingHz)),
        Math.cos(2 * Math.PI * (0.27 * subNorm + t * heartHz))
      );
      phaseRow.push(round(phase));
    }

    amplitudeMatrix.push(row);
    phaseMatrix.push(phaseRow);
    amplitudeTimeseries.push(round(mean(row), 6));

    const rssiBase = activity === "walking" ? -58 : activity === "fallen" ? -70 : activity === "sitting" ? -67 : -62;
    const rssiFluctuation = 2.2 * Math.sin(2 * Math.PI * 0.12 * t);
    rssiTimeseries.push(round(rssiBase + rssiFluctuation, 2));
  }

  const subcarrierProfile: number[] = [];
  for (let s = 0; s < numSubcarriers; s++) {
    subcarrierProfile.push(round(mean(amplitudeMatrix.map((row) => row[s])), 6));
  }

  const parsed: ParsedCSI = {
    format: "proof_bundle",
    sampleRateHz,
    durationSeconds,
    numFrames,
    numSubcarriers,
    numAntennas,
    nodeIds: [nodeId],
    scenarioHints: [activity],
    timestampsSeconds,
    amplitudeTimeseries,
    amplitudeMatrix,
    phaseMatrix,
    subcarrierProfile,
    rssiTimeseries,
  };

  return { parsed, activity };
}

