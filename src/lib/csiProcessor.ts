/**
 * CSI Signal Processing Engine
 *
 * Supports two sources:
 *   1) ESP32-style .csi.jsonl recordings (raw_csi lines)
 *   2) Proof-bundle JSON (frames with amplitude + phase matrices)
 *
 * This module now provides:
 *   - Vitals extraction (breathing/heart/HRV)
 *   - Static pose proxy estimation
 *   - Temporal motion + keypoint sequence synthesis for replay
 */

// ─── Types ────────────────────────────────────────────────────────────────────

/** One frame from Format A (.csi.jsonl, record-csi-udp.py style) */
export interface CSIFrameRaw {
  type: "raw_csi";
  timestamp: string | number;
  ts_ns?: number;
  node_id: number;
  rssi: number;
  channel: number;
  subcarriers: number;
  amplitudes?: number[];
  iq_hex?: string;
  scenario?: string;
}

/** One frame from Format B (proof bundle with deterministic CSI matrices) */
export interface CSIFrameProof {
  frame_index: number;
  timestamp_s: number;
  amplitude: number[][]; // [num_antennas][num_subcarriers]
  phase: number[][]; // [num_antennas][num_subcarriers]
}

export interface PoseKeypoint {
  point: string;
  x: number;
  y: number;
  confidence: number;
  z?: number;
}

export type DetectedFormat = "jsonl" | "proof_bundle" | "unknown";

export interface ParsedFusionNode {
  nodeId: number;
  frameCount: number;
  meanRssi: number;
  weight: number;
}

export interface ParsedFusionMeta {
  enabled: boolean;
  strategy: "none" | "weighted_time_aligned";
  nodeCount: number;
  nodes: ParsedFusionNode[];
}

export interface ParsedCSI {
  format: DetectedFormat;
  sampleRateHz: number;
  durationSeconds: number;
  numFrames: number;
  numSubcarriers: number;
  numAntennas: number;
  nodeIds: number[];
  /** Optional scenario hints from synthetic fixtures */
  scenarioHints: string[];
  /** Timestamp per frame (seconds from start), length = numFrames */
  timestampsSeconds: number[];
  /** Mean amplitude per frame, length = numFrames */
  amplitudeTimeseries: number[];
  /** Per-frame subcarrier amplitudes, shape = [numFrames][numSubcarriers] */
  amplitudeMatrix: number[][];
  /** Per-frame subcarrier phase (if available), shape = [numFrames][numSubcarriers] */
  phaseMatrix: number[][] | null;
  /** Mean amplitude per subcarrier across all frames, length = numSubcarriers */
  subcarrierProfile: number[];
  /** Mean RSSI per frame (Format A) or synthetic fallback (Format B), length = numFrames */
  rssiTimeseries: number[];
  /** Optional multi-node fusion metadata */
  fusion?: ParsedFusionMeta;
}

export interface ExtractedVitals {
  breathingRateBpm: number;
  heartRateBpm: number;
  hrv: number; // ms
}

export interface TemporalPoseFrame {
  t: number;
  keypoints: PoseKeypoint[];
  confidence: number;
  motionScore: number;
}

export interface TemporalPoseAnalysis {
  dominantMotionHz: number;
  breathingHz: number;
  motionEnergy: number;
  phaseStability: number;
  fps: number;
  windowSeconds: number;
  hopSeconds: number;
  sequence: TemporalPoseFrame[];
}

// ─── Parsing ──────────────────────────────────────────────────────────────────

export function detectFormat(text: string): DetectedFormat {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") && trimmed.includes("\"frames\"")) return "proof_bundle";
  if (trimmed.startsWith("{") && trimmed.includes("\"raw_csi\"")) return "jsonl";
  const firstLine = trimmed.split("\n").find((line) => line.trim().startsWith("{"));
  if (firstLine) {
    try {
      const obj = JSON.parse(firstLine) as Partial<CSIFrameRaw>;
      if (obj.type === "raw_csi" || Array.isArray(obj.amplitudes)) return "jsonl";
    } catch {
      // no-op: unknown format
    }
  }
  return "unknown";
}

function parseJSONL(text: string): CSIFrameRaw[] {
  return text
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("{"))
    .map((line) => {
      try {
        return JSON.parse(line) as CSIFrameRaw;
      } catch {
        return null;
      }
    })
    .filter(Boolean) as CSIFrameRaw[];
}

function parseProofBundle(text: string): CSIFrameProof[] {
  const data = JSON.parse(text) as { frames?: CSIFrameProof[] };
  return data.frames ?? [];
}

function decodeIqHexToAmplitudes(iqHex: string): number[] {
  const clean = iqHex.trim();
  if (clean.length < 4 || clean.length % 2 !== 0) return [];
  const amplitudes: number[] = [];

  for (let i = 0; i + 3 < clean.length; i += 4) {
    const iByte = Number.parseInt(clean.slice(i, i + 2), 16);
    const qByte = Number.parseInt(clean.slice(i + 2, i + 4), 16);
    if (Number.isNaN(iByte) || Number.isNaN(qByte)) return [];

    const iComp = iByte > 127 ? iByte - 256 : iByte;
    const qComp = qByte > 127 ? qByte - 256 : qByte;
    amplitudes.push(Math.sqrt(iComp * iComp + qComp * qComp));
  }

  return amplitudes;
}

interface NormalizedJsonlFrame {
  frame: CSIFrameRaw;
  amplitudes: number[];
  tsSeconds: number;
}

function frameTimestampSeconds(frame: CSIFrameRaw, fallbackIndex: number): number {
  if (typeof frame.ts_ns === "number" && Number.isFinite(frame.ts_ns)) {
    return frame.ts_ns / 1e9;
  }
  if (typeof frame.timestamp === "number" && Number.isFinite(frame.timestamp)) {
    return frame.timestamp;
  }
  if (typeof frame.timestamp === "string") {
    const parsedEpoch = Date.parse(frame.timestamp);
    if (Number.isFinite(parsedEpoch)) return parsedEpoch / 1000;
    const numeric = Number(frame.timestamp);
    if (Number.isFinite(numeric)) return numeric;
  }
  return fallbackIndex / 100;
}

function estimateSampleRate(timestampsSeconds: number[]): number {
  if (timestampsSeconds.length < 3) return 100;
  const intervals: number[] = [];
  for (let i = 1; i < timestampsSeconds.length; i++) {
    const dt = timestampsSeconds[i] - timestampsSeconds[i - 1];
    if (dt > 0) intervals.push(dt);
  }
  if (intervals.length === 0) return 100;
  intervals.sort((a, b) => a - b);
  const median = intervals[Math.floor(intervals.length / 2)];
  return Math.max(1, 1 / Math.max(median, 1e-4));
}

function buildSubcarrierProfile(amplitudeMatrix: number[][], numSubcarriers: number): number[] {
  const profile = new Array(numSubcarriers).fill(0);
  for (const row of amplitudeMatrix) {
    for (let i = 0; i < numSubcarriers; i++) {
      profile[i] += row[i];
    }
  }
  for (let i = 0; i < numSubcarriers; i++) {
    profile[i] /= Math.max(amplitudeMatrix.length, 1);
  }
  return profile;
}

function fuseMultiNodeFrames(
  normalizedFrames: NormalizedJsonlFrame[],
  numSubcarriers: number
): {
  amplitudeMatrix: number[][];
  rssiTimeseries: number[];
  timestampsSeconds: number[];
  fusion: ParsedFusionMeta;
} {
  const byNode = new Map<number, NormalizedJsonlFrame[]>();
  for (const entry of normalizedFrames) {
    const list = byNode.get(entry.frame.node_id) ?? [];
    list.push(entry);
    byNode.set(entry.frame.node_id, list);
  }
  for (const list of byNode.values()) {
    list.sort((a, b) => a.tsSeconds - b.tsSeconds);
  }

  const nodeEntries = [...byNode.entries()].sort((a, b) => a[0] - b[0]);
  const maxFrames = Math.max(...nodeEntries.map(([, frames]) => frames.length));
  const minStart = Math.min(...nodeEntries.map(([, frames]) => frames[0].tsSeconds));
  const maxEnd = Math.max(...nodeEntries.map(([, frames]) => frames[frames.length - 1].tsSeconds));
  const sampleRateHz = estimateSampleRate(normalizedFrames.map((entry) => entry.tsSeconds));
  const duration = Math.max(maxEnd - minStart, 0.01);
  const timelineLength = Math.max(8, Math.round(duration * sampleRateHz));

  const nodeWeightsRaw = nodeEntries.map(([nodeId, frames]) => {
    const meanRssi = mean(frames.map((entry) => entry.frame.rssi));
    const rssiScore = clamp((meanRssi + 92) / 38, 0.12, 1);
    const densityScore = clamp(frames.length / Math.max(maxFrames, 1), 0.2, 1);
    const weight = rssiScore * (0.45 + densityScore * 0.55);
    return {
      nodeId,
      frames,
      meanRssi,
      weightRaw: weight,
    };
  });
  const totalWeightRaw = nodeWeightsRaw.reduce((sum, node) => sum + node.weightRaw, 0);
  const nodeWeights = nodeWeightsRaw.map((node) => ({
    ...node,
    weight: node.weightRaw / Math.max(totalWeightRaw, 1e-6),
  }));

  const pointers = new Map<number, number>();
  for (const { nodeId } of nodeWeights) pointers.set(nodeId, 0);

  const amplitudeMatrix: number[][] = [];
  const rssiTimeseries: number[] = [];
  const timestampsSeconds: number[] = [];
  const toleranceSeconds = Math.max(1 / sampleRateHz, 0.015) * 2.4;

  for (let i = 0; i < timelineLength; i++) {
    const t = minStart + (i / Math.max(timelineLength - 1, 1)) * duration;
    const fused = new Array(numSubcarriers).fill(0);
    let fusedRssi = 0;
    let usedWeight = 0;

    for (const node of nodeWeights) {
      const nodeId = node.nodeId;
      const frames = node.frames;
      let pointer = pointers.get(nodeId) ?? 0;
      while (pointer + 1 < frames.length && frames[pointer + 1].tsSeconds <= t) pointer++;
      pointers.set(nodeId, pointer);

      const candidates = [frames[pointer], frames[Math.min(pointer + 1, frames.length - 1)]].filter(
        Boolean
      ) as NormalizedJsonlFrame[];
      if (candidates.length === 0) continue;
      const nearest = candidates.reduce((best, candidate) =>
        Math.abs(candidate.tsSeconds - t) < Math.abs(best.tsSeconds - t) ? candidate : best
      );
      const age = Math.abs(nearest.tsSeconds - t);
      if (age > toleranceSeconds) continue;

      const temporalWeight = node.weight * clamp(1 - age / toleranceSeconds, 0.18, 1);
      for (let s = 0; s < numSubcarriers; s++) {
        fused[s] += nearest.amplitudes[s] * temporalWeight;
      }
      fusedRssi += nearest.frame.rssi * temporalWeight;
      usedWeight += temporalWeight;
    }

    if (usedWeight <= 0.00001) continue;
    amplitudeMatrix.push(fused.map((value) => value / usedWeight));
    rssiTimeseries.push(fusedRssi / usedWeight);
    timestampsSeconds.push(t - minStart);
  }

  return {
    amplitudeMatrix,
    rssiTimeseries,
    timestampsSeconds,
    fusion: {
      enabled: true,
      strategy: "weighted_time_aligned",
      nodeCount: nodeWeights.length,
      nodes: nodeWeights.map((node) => ({
        nodeId: node.nodeId,
        frameCount: node.frames.length,
        meanRssi: Number(node.meanRssi.toFixed(2)),
        weight: Number(node.weight.toFixed(4)),
      })),
    },
  };
}

/**
 * Parse raw CSI file text into a uniform representation used by DSP and temporal models.
 */
export function parseCsiFile(text: string): ParsedCSI {
  const format = detectFormat(text);

  if (format === "jsonl") {
    const frames = parseJSONL(text);
    if (frames.length === 0) throw new Error("No valid JSONL frames found");

    const normalizedFrames = frames
      .map((frame, index) => {
        const amplitudes =
          Array.isArray(frame.amplitudes) && frame.amplitudes.length > 0
            ? frame.amplitudes
            : typeof frame.iq_hex === "string"
            ? decodeIqHexToAmplitudes(frame.iq_hex)
            : [];
        return {
          frame,
          amplitudes,
          tsSeconds: frameTimestampSeconds(frame, index),
        } satisfies NormalizedJsonlFrame;
      })
      .filter((entry) => entry.amplitudes.length > 0);

    if (normalizedFrames.length === 0) {
      throw new Error("No amplitude data found (amplitudes[] or iq_hex required)");
    }

    const firstAmplitudes = normalizedFrames[0].amplitudes;
    const numSubcarriers = normalizedFrames[0].frame.subcarriers || firstAmplitudes.length;
    const usableFrames = normalizedFrames.filter((entry) => entry.amplitudes.length >= Math.min(8, numSubcarriers));
    if (usableFrames.length === 0) {
      throw new Error("No usable CSI frames with valid amplitude payload");
    }

    const nodeIds = [...new Set(usableFrames.map((entry) => entry.frame.node_id))];

    let amplitudeMatrix: number[][];
    let rssiTimeseries: number[];
    let timestampsSeconds: number[];
    let fusion: ParsedFusionMeta | undefined;

    if (nodeIds.length > 1) {
      const fused = fuseMultiNodeFrames(
        usableFrames.map((entry) => ({
          ...entry,
          amplitudes: entry.amplitudes.slice(0, numSubcarriers),
        })),
        numSubcarriers
      );
      amplitudeMatrix = fused.amplitudeMatrix;
      rssiTimeseries = fused.rssiTimeseries;
      timestampsSeconds = fused.timestampsSeconds;
      fusion = fused.fusion;
    } else {
      amplitudeMatrix = usableFrames.map((entry) => entry.amplitudes.slice(0, numSubcarriers));
      rssiTimeseries = usableFrames.map((entry) => entry.frame.rssi);
      const tsAbs = usableFrames.map((entry) => entry.tsSeconds);
      const t0 = tsAbs[0];
      timestampsSeconds = tsAbs.map((t) => t - t0);
      fusion = {
        enabled: false,
        strategy: "none",
        nodeCount: 1,
        nodes: [
          {
            nodeId: nodeIds[0],
            frameCount: usableFrames.length,
            meanRssi: Number(mean(rssiTimeseries).toFixed(2)),
            weight: 1,
          },
        ],
      };
    }

    if (amplitudeMatrix.length === 0) {
      throw new Error("Unable to fuse CSI frames into a usable sequence.");
    }

    const amplitudeTimeseries = amplitudeMatrix.map((row) => mean(row));
    const subcarrierProfile = buildSubcarrierProfile(amplitudeMatrix, numSubcarriers);
    const durationSeconds =
      timestampsSeconds.length > 1
        ? timestampsSeconds[timestampsSeconds.length - 1]
        : amplitudeMatrix.length / 100;
    const sampleRateHz = amplitudeMatrix.length / Math.max(durationSeconds, 0.001);
    const scenarioHints = [
      ...new Set(
        usableFrames
          .map((entry) => entry.frame.scenario)
          .filter((value): value is string => typeof value === "string" && value.length > 0)
      ),
    ];

    return {
      format,
      sampleRateHz,
      durationSeconds,
      numFrames: amplitudeMatrix.length,
      numSubcarriers,
      numAntennas: 1,
      nodeIds,
      scenarioHints,
      timestampsSeconds,
      amplitudeTimeseries,
      amplitudeMatrix,
      phaseMatrix: null,
      subcarrierProfile,
      rssiTimeseries,
      fusion,
    };
  }

  if (format === "proof_bundle") {
    const frames = parseProofBundle(text);
    if (frames.length === 0) throw new Error("No valid proof bundle frames found");

    const numAntennas = frames[0].amplitude.length;
    const numSubcarriers = frames[0].amplitude[0].length;

    const amplitudeMatrix = frames.map((f) => {
      const row = new Array(numSubcarriers).fill(0);
      for (let a = 0; a < numAntennas; a++) {
        for (let s = 0; s < numSubcarriers; s++) {
          row[s] += f.amplitude[a][s];
        }
      }
      for (let s = 0; s < numSubcarriers; s++) {
        row[s] /= numAntennas;
      }
      return row;
    });

    const phaseMatrix = frames.map((f) => {
      const row = new Array(numSubcarriers).fill(0);
      for (let s = 0; s < numSubcarriers; s++) {
        const phases = f.phase.map((antennaRow) => antennaRow[s]);
        row[s] = circularMean(phases);
      }
      return row;
    });

    const amplitudeTimeseries = amplitudeMatrix.map((row) => mean(row));
    const subcarrierProfile = new Array(numSubcarriers).fill(0);
    amplitudeMatrix.forEach((row) => {
      row.forEach((value, s) => {
        subcarrierProfile[s] += value;
      });
    });
    for (let s = 0; s < subcarrierProfile.length; s++) {
      subcarrierProfile[s] /= amplitudeMatrix.length;
    }

    const tsAbs = frames.map((f) => f.timestamp_s);
    const t0 = tsAbs[0];
    const timestampsSeconds = tsAbs.map((t) => t - t0);
    const durationSeconds =
      timestampsSeconds.length > 1
        ? timestampsSeconds[timestampsSeconds.length - 1]
        : frames.length / 100;
    const sampleRateHz = frames.length / Math.max(durationSeconds, 0.001);

    return {
      format,
      sampleRateHz,
      durationSeconds,
      numFrames: frames.length,
      numSubcarriers,
      numAntennas,
      nodeIds: [0],
      scenarioHints: [],
      timestampsSeconds,
      amplitudeTimeseries,
      amplitudeMatrix,
      phaseMatrix,
      subcarrierProfile,
      rssiTimeseries: frames.map(() => -65),
      fusion: {
        enabled: false,
        strategy: "none",
        nodeCount: 1,
        nodes: [
          {
            nodeId: 0,
            frameCount: frames.length,
            meanRssi: -65,
            weight: 1,
          },
        ],
      },
    };
  }

  throw new Error("Unrecognized CSI format. Expected .csi.jsonl or proof-bundle JSON");
}

// ─── Core DSP utilities ───────────────────────────────────────────────────────

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = mean(values);
  const variance =
    values.reduce((sum, value) => sum + (value - m) * (value - m), 0) / values.length;
  return Math.sqrt(variance);
}

function circularMean(phases: number[]): number {
  if (phases.length === 0) return 0;
  const sinMean = mean(phases.map((p) => Math.sin(p)));
  const cosMean = mean(phases.map((p) => Math.cos(p)));
  return Math.atan2(sinMean, cosMean);
}

function normalize01(values: number[]): number[] {
  if (values.length === 0) return [];
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const denom = hi - lo || 1;
  return values.map((v) => (v - lo) / denom);
}

/** Simple IIR bandpass filter (2nd-order approximation). */
function bandpassFilter(
  signal: number[],
  sampleRateHz: number,
  lowHz: number,
  highHz: number
): number[] {
  if (signal.length === 0 || sampleRateHz <= 0) return [];
  const nyq = sampleRateHz / 2;
  const lowNorm = clamp(lowHz / nyq, 0.0001, 0.999);
  const highNorm = clamp(highHz / nyq, lowNorm + 0.0001, 0.9999);
  const bw = highNorm - lowNorm;
  const center = Math.sqrt(lowNorm * highNorm);

  const filtered: number[] = new Array(signal.length).fill(0);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  const alpha = Math.sin(Math.PI * bw);
  const cosOmega = Math.cos(2 * Math.PI * center);
  const a0 = 1 + alpha;

  const b0 = (alpha / 2) / a0;
  const b1 = 0;
  const b2 = -(alpha / 2) / a0;
  const a1 = (-2 * cosOmega) / a0;
  const a2 = (1 - alpha) / a0;

  for (let i = 0; i < signal.length; i++) {
    const x0 = signal[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    filtered[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return filtered;
}

function zeroCrossingRate(signal: number[], sampleRateHz: number): number {
  if (signal.length < 2 || sampleRateHz <= 0) return 0;
  let crossings = 0;
  for (let i = 1; i < signal.length; i++) {
    if (
      (signal[i - 1] >= 0 && signal[i] < 0) ||
      (signal[i - 1] < 0 && signal[i] >= 0)
    ) {
      crossings++;
    }
  }
  const durationSeconds = signal.length / sampleRateHz;
  const cyclesPerSecond = crossings / 2 / Math.max(durationSeconds, 0.001);
  return cyclesPerSecond * 60;
}

function findPeaks(signal: number[], minDistance = 5): number[] {
  if (signal.length < 3) return [];
  const peaks: number[] = [];
  const threshold = mean(signal);
  for (let i = 1; i < signal.length - 1; i++) {
    if (signal[i] > threshold && signal[i] > signal[i - 1] && signal[i] > signal[i + 1]) {
      if (peaks.length === 0 || i - peaks[peaks.length - 1] >= minDistance) {
        peaks.push(i);
      }
    }
  }
  return peaks;
}

function calculateHRV(peaks: number[], sampleRateHz: number): number {
  if (peaks.length < 3 || sampleRateHz <= 0) return 42;
  const rrIntervals = peaks
    .slice(1)
    .map((peak, i) => ((peak - peaks[i]) / sampleRateHz) * 1000);
  const diffs = rrIntervals.slice(1).map((rr, i) => rr - rrIntervals[i]);
  const rmssd = Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / Math.max(diffs.length, 1));
  return Math.round(clamp(rmssd, 10, 120));
}

/**
 * Approximate dominant frequency in a bounded range using a small DFT scan.
 * This avoids adding heavy dependencies and remains fast for our sequence sizes.
 */
function dominantFrequency(
  signal: number[],
  sampleRateHz: number,
  minHz: number,
  maxHz: number
): number {
  if (signal.length < 16 || sampleRateHz <= 0 || maxHz <= minHz) return minHz;
  const centered = signal.map((value) => value - mean(signal));
  const n = centered.length;
  const startBin = Math.max(1, Math.floor((minHz * n) / sampleRateHz));
  const endBin = Math.min(Math.floor((maxHz * n) / sampleRateHz), Math.floor(n / 2));

  let bestBin = startBin;
  let bestPower = -Infinity;

  for (let k = startBin; k <= endBin; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const phi = (2 * Math.PI * k * t) / n;
      re += centered[t] * Math.cos(phi);
      im -= centered[t] * Math.sin(phi);
    }
    const power = re * re + im * im;
    if (power > bestPower) {
      bestPower = power;
      bestBin = k;
    }
  }

  return (bestBin * sampleRateHz) / n;
}

function phaseStabilityScore(phaseMatrix: number[][] | null): number {
  if (!phaseMatrix || phaseMatrix.length < 2) return 0.75;
  let total = 0;
  let count = 0;
  for (let i = 1; i < phaseMatrix.length; i++) {
    const prev = phaseMatrix[i - 1];
    const curr = phaseMatrix[i];
    const maxLen = Math.min(prev.length, curr.length);
    for (let s = 0; s < maxLen; s++) {
      const diff = curr[s] - prev[s];
      const wrapped = Math.atan2(Math.sin(diff), Math.cos(diff));
      total += Math.abs(wrapped);
      count++;
    }
  }
  if (count === 0) return 0.75;
  const meanAbsDiff = total / count;
  return clamp(1 - meanAbsDiff / Math.PI, 0.35, 1.0);
}

// ─── Static extraction ────────────────────────────────────────────────────────

export function extractVitals(parsed: ParsedCSI): ExtractedVitals {
  const { amplitudeTimeseries, sampleRateHz } = parsed;
  const centered = amplitudeTimeseries.map((value) => value - mean(amplitudeTimeseries));

  const breathingFiltered = bandpassFilter(centered, sampleRateHz, 0.1, 0.5);
  const breathingBpm = Math.round(zeroCrossingRate(breathingFiltered, sampleRateHz));

  const hrFiltered = bandpassFilter(centered, sampleRateHz, 0.8, 2.0);
  const heartRateBpm = Math.round(zeroCrossingRate(hrFiltered, sampleRateHz));

  const peaks = findPeaks(hrFiltered, Math.max(2, Math.floor(sampleRateHz * 0.4)));
  const hrv = calculateHRV(peaks, sampleRateHz);

  return {
    breathingRateBpm: Math.round(clamp(breathingBpm || 14, 6, 30)),
    heartRateBpm: Math.round(clamp(heartRateBpm || 72, 40, 120)),
    hrv,
  };
}

/**
 * Converts the subcarrier profile into an approximate 17-keypoint skeleton.
 * This is still a proxy model, but useful as a stable body-shape anchor.
 */
export function estimatePoseFromCSI(parsed: ParsedCSI) {
  const normalized = normalize01(parsed.subcarrierProfile);
  const zones = {
    head: avg(normalized, 0.0, 0.1),
    shoulders: avg(normalized, 0.1, 0.25),
    torso: avg(normalized, 0.25, 0.5),
    hips: avg(normalized, 0.5, 0.65),
    thighs: avg(normalized, 0.65, 0.8),
    calves: avg(normalized, 0.8, 1.0),
  };

  const shoulderWidth = 0.30 + zones.shoulders * 0.15;
  const hipWidth = 0.25 + zones.hips * 0.12;

  return {
    shoulderWidthProxy: shoulderWidth,
    hipWidthProxy: hipWidth,
    zoneEnergies: zones,
    keypoints: buildKeypointsFromProportions(shoulderWidth, hipWidth, 0.06, 0.20, 0.52),
  };
}

function avg(arr: number[], fromFrac: number, toFrac: number): number {
  if (arr.length === 0) return 0;
  const start = Math.floor(fromFrac * arr.length);
  const end = Math.max(start + 1, Math.ceil(toFrac * arr.length));
  const slice = arr.slice(start, end);
  return mean(slice);
}

function buildKeypointsFromProportions(
  shoulderWidth: number,
  hipWidth: number,
  headY: number,
  shoulderY: number,
  hipY: number
): PoseKeypoint[] {
  const leftShoulderX = 0.5 - shoulderWidth / 2;
  const rightShoulderX = 0.5 + shoulderWidth / 2;
  const leftHipX = 0.5 - hipWidth / 2;
  const rightHipX = 0.5 + hipWidth / 2;
  const kneeY = hipY + 0.20;
  const ankleY = hipY + 0.40;
  const elbowY = (shoulderY + hipY) / 2;
  const wristY = elbowY + 0.16;

  return [
    { point: "nose", x: 0.50, y: headY, confidence: 0.88 },
    { point: "left_eye", x: 0.47, y: headY - 0.02, confidence: 0.85 },
    { point: "right_eye", x: 0.53, y: headY - 0.02, confidence: 0.85 },
    { point: "left_ear", x: 0.44, y: headY, confidence: 0.82 },
    { point: "right_ear", x: 0.56, y: headY, confidence: 0.82 },
    { point: "left_shoulder", x: leftShoulderX, y: shoulderY, confidence: 0.92 },
    { point: "right_shoulder", x: rightShoulderX, y: shoulderY, confidence: 0.92 },
    { point: "left_elbow", x: leftShoulderX - 0.04, y: elbowY, confidence: 0.84 },
    { point: "right_elbow", x: rightShoulderX + 0.04, y: elbowY, confidence: 0.84 },
    { point: "left_wrist", x: leftShoulderX - 0.06, y: wristY, confidence: 0.79 },
    { point: "right_wrist", x: rightShoulderX + 0.06, y: wristY, confidence: 0.79 },
    { point: "left_hip", x: leftHipX, y: hipY, confidence: 0.90 },
    { point: "right_hip", x: rightHipX, y: hipY, confidence: 0.90 },
    { point: "left_knee", x: leftHipX + 0.01, y: kneeY, confidence: 0.86 },
    { point: "right_knee", x: rightHipX - 0.01, y: kneeY, confidence: 0.86 },
    { point: "left_ankle", x: leftHipX + 0.01, y: ankleY, confidence: 0.83 },
    { point: "right_ankle", x: rightHipX - 0.01, y: ankleY, confidence: 0.83 },
  ];
}

// ─── Temporal pose synthesis ──────────────────────────────────────────────────

function mutatePoint(
  keypoints: PoseKeypoint[],
  pointName: string,
  deltaX: number,
  deltaY: number,
  confidenceScale = 1
): void {
  const point = keypoints.find((kp) => kp.point === pointName);
  if (!point) return;
  point.x += deltaX;
  point.y += deltaY;
  point.confidence *= confidenceScale;
}

function synthesizePoseFrame(
  basePose: PoseKeypoint[],
  motionPhase: number,
  breathingPhase: number,
  motionScore: number,
  dominantMotionHz: number,
  motionEnergy: number
): PoseKeypoint[] {
  const out = basePose.map((kp) => ({ ...kp, z: kp.z ?? 0.5 }));
  const motionGain = clamp(motionScore, 0.2, 2.2);
  const cadenceFactor = clamp(dominantMotionHz / 1.2, 0, 1.4);
  const energyFactor = clamp(motionEnergy / 0.09, 0, 1.4);
  const dynamics = clamp(cadenceFactor * 0.45 + energyFactor * 0.55, 0.15, 1.4);

  const sway = 0.008 * Math.sin(motionPhase * 0.5) * (0.5 + dynamics * 0.5);
  const breathingLift = 0.008 * Math.sin(breathingPhase);

  // Shared micro-motion
  ["nose", "left_eye", "right_eye", "left_ear", "right_ear"].forEach((p) =>
    mutatePoint(out, p, sway * 0.8, breathingLift * -1, 1.01)
  );
  ["left_shoulder", "right_shoulder", "left_hip", "right_hip"].forEach((p) =>
    mutatePoint(out, p, sway * 0.5, breathingLift * -0.6, 1.0)
  );

  const stride = (0.010 + 0.020 * dynamics) * Math.min(1.25, motionGain);
  const lift = 0.006 + 0.018 * dynamics;
  const armSwing = stride * 1.2;
  const leftStep = Math.sin(motionPhase);
  const rightStep = Math.sin(motionPhase + Math.PI);

  mutatePoint(out, "left_hip", -0.008 * leftStep, 0.003 * Math.abs(leftStep), 0.99);
  mutatePoint(out, "right_hip", -0.008 * rightStep, 0.003 * Math.abs(rightStep), 0.99);

  mutatePoint(out, "left_knee", -stride * leftStep, -lift * Math.max(0, leftStep), 0.97);
  mutatePoint(out, "right_knee", -stride * rightStep, -lift * Math.max(0, rightStep), 0.97);
  mutatePoint(out, "left_ankle", -stride * 1.15 * leftStep, -0.65 * lift * Math.max(0, leftStep), 0.96);
  mutatePoint(out, "right_ankle", -stride * 1.15 * rightStep, -0.65 * lift * Math.max(0, rightStep), 0.96);

  mutatePoint(out, "left_elbow", armSwing * rightStep, 0.010 * Math.abs(rightStep), 0.98);
  mutatePoint(out, "right_elbow", -armSwing * rightStep, 0.010 * Math.abs(rightStep), 0.98);
  mutatePoint(out, "left_wrist", armSwing * 1.25 * rightStep, 0.018 * Math.abs(rightStep), 0.97);
  mutatePoint(out, "right_wrist", -armSwing * 1.25 * rightStep, 0.018 * Math.abs(rightStep), 0.97);

  const settle = (1 - clamp(dynamics, 0, 1)) * 0.018;
  mutatePoint(out, "left_hip", -0.006, settle, 0.99);
  mutatePoint(out, "right_hip", 0.006, settle, 0.99);
  mutatePoint(out, "nose", 0, settle * 0.22, 0.99);

  for (const kp of out) {
    kp.x = clamp(kp.x, 0.03, 0.97);
    kp.y = clamp(kp.y, 0.02, 0.98);
    kp.confidence = clamp(kp.confidence, 0.45, 0.99);
  }
  return out;
}

function smoothSequence(sequence: TemporalPoseFrame[], alpha = 0.32): TemporalPoseFrame[] {
  if (sequence.length < 2) return sequence;
  const smoothed = sequence.map((frame) => ({
    ...frame,
    keypoints: frame.keypoints.map((kp) => ({ ...kp })),
  }));

  for (let i = 1; i < smoothed.length; i++) {
    const prev = smoothed[i - 1];
    const curr = smoothed[i];
    for (let k = 0; k < curr.keypoints.length; k++) {
      const keypoint = curr.keypoints[k];
      const prevKeypoint = prev.keypoints[k];
      if (!prevKeypoint || prevKeypoint.point !== keypoint.point) continue;
      keypoint.x = alpha * keypoint.x + (1 - alpha) * prevKeypoint.x;
      keypoint.y = alpha * keypoint.y + (1 - alpha) * prevKeypoint.y;
      keypoint.confidence = alpha * keypoint.confidence + (1 - alpha) * prevKeypoint.confidence;
    }
  }
  return smoothed;
}

/**
 * Temporal motion pipeline:
 *   sliding window features -> motion dynamics scoring -> keypoint sequence synthesis
 */
export function analyzeTemporalPose(parsed: ParsedCSI): TemporalPoseAnalysis {
  const sampleRateHz = Math.max(1, parsed.sampleRateHz);
  const centered = parsed.amplitudeTimeseries.map((value) => value - mean(parsed.amplitudeTimeseries));
  const globalStd = Math.max(std(centered), 1e-6);
  const motionEnergy = globalStd / Math.max(mean(parsed.amplitudeTimeseries), 1);

  const dominantMotionHz = dominantFrequency(centered, sampleRateHz, 0.08, 2.5);
  const breathingHz = dominantFrequency(centered, sampleRateHz, 0.10, 0.60);
  const phaseStability = phaseStabilityScore(parsed.phaseMatrix);

  const basePose = estimatePoseFromCSI(parsed).keypoints;
  const fps = sampleRateHz >= 80 ? 12 : 8;
  const hopSeconds = 1 / fps;
  const windowSeconds = 1.0;
  const hopSamples = Math.max(1, Math.round(hopSeconds * sampleRateHz));
  const windowSamples = Math.max(8, Math.round(windowSeconds * sampleRateHz));

  const sequence: TemporalPoseFrame[] = [];
  const maxFrames = 360;
  let frameIndex = 0;

  for (let start = 0; start < parsed.numFrames; start += hopSamples) {
    const end = Math.min(parsed.numFrames, start + windowSamples);
    if (end - start < 8) break;
    const local = centered.slice(start, end);
    const localStd = std(local);
    const motionScore = clamp(localStd / globalStd, 0.15, 2.20);
    const centerIdx = Math.min(parsed.numFrames - 1, start + Math.floor((end - start) / 2));
    const t = parsed.timestampsSeconds[centerIdx] ?? frameIndex * hopSeconds;

    const motionPhase = 2 * Math.PI * dominantMotionHz * t;
    const breathingPhase = 2 * Math.PI * breathingHz * t;
    const keypoints = synthesizePoseFrame(
      basePose,
      motionPhase,
      breathingPhase,
      motionScore,
      dominantMotionHz,
      motionEnergy
    );
    const confidence = clamp(
      0.55 + 0.22 * phaseStability + 0.12 * Math.min(1.2, motionScore / 1.2),
      0.55,
      0.98
    );

    sequence.push({
      t,
      keypoints,
      confidence,
      motionScore,
    });

    frameIndex++;
    if (sequence.length >= maxFrames) break;
  }

  const safeSequence =
    sequence.length > 0
      ? smoothSequence(sequence)
      : [
          {
            t: 0,
            keypoints: basePose,
            confidence: 0.72,
            motionScore: 0.2,
          },
        ];

  return {
    dominantMotionHz: Number(dominantMotionHz.toFixed(3)),
    breathingHz: Number(breathingHz.toFixed(3)),
    motionEnergy: Number(motionEnergy.toFixed(4)),
    phaseStability: Number(phaseStability.toFixed(3)),
    fps,
    windowSeconds,
    hopSeconds,
    sequence: safeSequence,
  };
}

