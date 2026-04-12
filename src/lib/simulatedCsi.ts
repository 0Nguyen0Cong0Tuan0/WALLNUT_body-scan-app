import type { ParsedCSI } from "@/lib/csiProcessor";

interface SimulatedSubjectPreset {
  id: string;
  zoneGains: [number, number, number, number, number, number];
  breathingHzRange: [number, number];
  heartHzRange: [number, number];
  motionHzRange: [number, number];
  breathingDepthRange: [number, number];
  cardiacDepthRange: [number, number];
  motionDepthRange: [number, number];
  noiseSigmaRange: [number, number];
  rssiBaseRange: [number, number];
  sampleRateRange: [number, number];
  durationRange: [number, number];
}

interface SampledProfile {
  id: string;
  zoneGains: [number, number, number, number, number, number];
  breathingHz: number;
  heartHz: number;
  motionHz: number;
  breathingDepth: number;
  cardiacDepth: number;
  motionDepth: number;
  noiseSigma: number;
  rssiBase: number;
  sampleRateHz: number;
  durationSeconds: number;
  nodeId: number;
}

interface MultipathModel {
  pathDelaysNs: number[];
  pathAmplitudes: number[];
  pathPhaseOffsets: number[];
  breathingPhase: number;
  heartPhase: number;
  motionPhase: number;
  driftPhase: number;
}

const SUBJECT_PRESETS: SimulatedSubjectPreset[] = [
  {
    id: "balanced-core",
    zoneGains: [0.96, 1.05, 1.0, 1.0, 0.97, 0.94],
    breathingHzRange: [0.21, 0.28],
    heartHzRange: [1.02, 1.30],
    motionHzRange: [0.28, 0.58],
    breathingDepthRange: [0.075, 0.100],
    cardiacDepthRange: [0.022, 0.036],
    motionDepthRange: [0.018, 0.040],
    noiseSigmaRange: [0.012, 0.024],
    rssiBaseRange: [-64, -60],
    sampleRateRange: [94, 114],
    durationRange: [5.8, 8.2],
  },
  {
    id: "broad-upper-body",
    zoneGains: [0.88, 1.34, 1.12, 0.74, 0.88, 0.84],
    breathingHzRange: [0.20, 0.26],
    heartHzRange: [0.98, 1.20],
    motionHzRange: [0.22, 0.52],
    breathingDepthRange: [0.070, 0.095],
    cardiacDepthRange: [0.020, 0.032],
    motionDepthRange: [0.015, 0.032],
    noiseSigmaRange: [0.011, 0.022],
    rssiBaseRange: [-62, -58],
    sampleRateRange: [92, 112],
    durationRange: [6.0, 8.5],
  },
  {
    id: "compact-frame",
    zoneGains: [1.02, 0.70, 0.88, 1.20, 1.04, 1.02],
    breathingHzRange: [0.23, 0.30],
    heartHzRange: [1.08, 1.36],
    motionHzRange: [0.24, 0.56],
    breathingDepthRange: [0.078, 0.104],
    cardiacDepthRange: [0.024, 0.038],
    motionDepthRange: [0.016, 0.036],
    noiseSigmaRange: [0.012, 0.023],
    rssiBaseRange: [-68, -64],
    sampleRateRange: [96, 118],
    durationRange: [5.6, 7.8],
  },
  {
    id: "lower-body-dominant",
    zoneGains: [0.90, 0.78, 0.96, 1.28, 1.22, 1.08],
    breathingHzRange: [0.20, 0.27],
    heartHzRange: [1.00, 1.26],
    motionHzRange: [0.36, 0.90],
    breathingDepthRange: [0.070, 0.092],
    cardiacDepthRange: [0.021, 0.034],
    motionDepthRange: [0.030, 0.070],
    noiseSigmaRange: [0.014, 0.028],
    rssiBaseRange: [-63, -59],
    sampleRateRange: [98, 120],
    durationRange: [5.4, 7.6],
  },
  {
    id: "dynamic-variability",
    zoneGains: [0.92, 1.22, 1.04, 0.82, 0.96, 0.92],
    breathingHzRange: [0.24, 0.32],
    heartHzRange: [1.14, 1.48],
    motionHzRange: [0.70, 1.35],
    breathingDepthRange: [0.060, 0.085],
    cardiacDepthRange: [0.026, 0.040],
    motionDepthRange: [0.050, 0.100],
    noiseSigmaRange: [0.016, 0.032],
    rssiBaseRange: [-61, -57],
    sampleRateRange: [100, 120],
    durationRange: [5.2, 7.0],
  },
];

const NUM_SUBCARRIERS = 56;
const NUM_ANTENNAS = 1;
const CENTER_FREQ_HZ = 5.21e9;
const SUBCARRIER_SPACING_HZ = 312_500;

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function round(value: number, digits = 5): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function createRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomInRange(rng: () => number, minValue: number, maxValue: number): number {
  return minValue + (maxValue - minValue) * rng();
}

function randomInt(rng: () => number, minValue: number, maxValue: number): number {
  return Math.floor(randomInRange(rng, minValue, maxValue + 1));
}

function randomGaussian(rng: () => number, meanValue = 0, sigma = 1): number {
  const u1 = Math.max(rng(), 1e-9);
  const u2 = rng();
  const z0 = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return meanValue + z0 * sigma;
}

function gaussianZone(x: number, center: number, width: number): number {
  return Math.exp(-((x - center) ** 2) / (2 * width * width));
}

function morphologyGain(zoneGains: SampledProfile["zoneGains"], subNorm: number): number {
  const zones: Array<[number, number, number]> = [
    [0.05, 0.08, zoneGains[0]],
    [0.18, 0.11, zoneGains[1]],
    [0.38, 0.15, zoneGains[2]],
    [0.58, 0.13, zoneGains[3]],
    [0.73, 0.11, zoneGains[4]],
    [0.90, 0.09, zoneGains[5]],
  ];

  let weighted = 0;
  let baseline = 0;
  for (const [center, width, gain] of zones) {
    const kernel = gaussianZone(subNorm, center, width);
    weighted += kernel * gain;
    baseline += kernel;
  }
  return weighted / Math.max(baseline, 1e-6);
}

function sampleProfile(rng: () => number): SampledProfile {
  const preset = SUBJECT_PRESETS[randomInt(rng, 0, SUBJECT_PRESETS.length - 1)];
  const jitteredZones = preset.zoneGains.map((gain) =>
    round(clamp(gain + randomGaussian(rng, 0, 0.075), 0.62, 1.42), 4)
  ) as SampledProfile["zoneGains"];

  return {
    id: preset.id,
    zoneGains: jitteredZones,
    breathingHz: round(randomInRange(rng, preset.breathingHzRange[0], preset.breathingHzRange[1]), 4),
    heartHz: round(randomInRange(rng, preset.heartHzRange[0], preset.heartHzRange[1]), 4),
    motionHz: round(randomInRange(rng, preset.motionHzRange[0], preset.motionHzRange[1]), 4),
    breathingDepth: round(randomInRange(rng, preset.breathingDepthRange[0], preset.breathingDepthRange[1]), 5),
    cardiacDepth: round(randomInRange(rng, preset.cardiacDepthRange[0], preset.cardiacDepthRange[1]), 5),
    motionDepth: round(randomInRange(rng, preset.motionDepthRange[0], preset.motionDepthRange[1]), 5),
    noiseSigma: round(randomInRange(rng, preset.noiseSigmaRange[0], preset.noiseSigmaRange[1]), 5),
    rssiBase: round(randomInRange(rng, preset.rssiBaseRange[0], preset.rssiBaseRange[1]), 2),
    sampleRateHz: Math.round(randomInRange(rng, preset.sampleRateRange[0], preset.sampleRateRange[1])),
    durationSeconds: round(randomInRange(rng, preset.durationRange[0], preset.durationRange[1]), 3),
    nodeId: randomInt(rng, 901, 978),
  };
}

function buildMultipathModel(rng: () => number): MultipathModel {
  const baseDelays = [0, 15, 42, 78, 120];
  const baseAmplitudes = [1.0, 0.62, 0.38, 0.21, 0.11];

  const pathDelaysNs = baseDelays.map((delayNs) => round(delayNs + randomGaussian(rng, 0, 2.0), 4));
  const pathAmplitudes = baseAmplitudes.map((amp) => round(amp * randomInRange(rng, 0.92, 1.08), 6));
  const pathPhaseOffsets = pathAmplitudes.map(() => randomInRange(rng, -Math.PI, Math.PI));

  return {
    pathDelaysNs,
    pathAmplitudes,
    pathPhaseOffsets,
    breathingPhase: randomInRange(rng, 0, 2 * Math.PI),
    heartPhase: randomInRange(rng, 0, 2 * Math.PI),
    motionPhase: randomInRange(rng, 0, 2 * Math.PI),
    driftPhase: randomInRange(rng, 0, 2 * Math.PI),
  };
}

function generateFrame(
  t: number,
  profile: SampledProfile,
  multipath: MultipathModel,
  rng: () => number
): { amplitude: number[]; phase: number[] } {
  const breathing = 1 + profile.breathingDepth * Math.sin(2 * Math.PI * profile.breathingHz * t + multipath.breathingPhase);
  const heart = 1 + profile.cardiacDepth * Math.sin(2 * Math.PI * profile.heartHz * t + multipath.heartPhase);
  const motion = 1 + profile.motionDepth * Math.sin(2 * Math.PI * profile.motionHz * t + multipath.motionPhase);
  const drift = 1 + 0.025 * Math.sin(2 * Math.PI * 0.05 * t + multipath.driftPhase);
  const temporalMod = breathing * heart * motion * drift;

  const amplitude: number[] = [];
  const phase: number[] = [];

  for (let subcarrier = 0; subcarrier < NUM_SUBCARRIERS; subcarrier++) {
    const k = subcarrier - NUM_SUBCARRIERS / 2;
    const subcarrierHz = CENTER_FREQ_HZ + k * SUBCARRIER_SPACING_HZ;
    const subNorm = subcarrier / Math.max(1, NUM_SUBCARRIERS - 1);
    const morph = morphologyGain(profile.zoneGains, subNorm);

    let re = 0;
    let im = 0;
    for (let path = 0; path < multipath.pathAmplitudes.length; path++) {
      const tau = multipath.pathDelaysNs[path] * 1e-9;
      const phaseShift = 2 * Math.PI * subcarrierHz * tau + multipath.pathPhaseOffsets[path];
      const ripple = 1 + 0.022 * Math.sin(2 * Math.PI * (0.14 * subcarrier + 0.11 * t + path * 0.31));
      const gain = multipath.pathAmplitudes[path] * morph * temporalMod * ripple;
      re += gain * Math.cos(phaseShift);
      im += gain * Math.sin(phaseShift);
    }

    re += randomGaussian(rng, 0, profile.noiseSigma);
    im += randomGaussian(rng, 0, profile.noiseSigma);

    const amp = Math.max(0.01, Math.hypot(re, im));
    amplitude.push(round(amp, 6));
    phase.push(round(Math.atan2(im, re), 6));
  }

  return { amplitude, phase };
}

export function generateSimulatedParsedCsi(): ParsedCSI {
  const seed = (Date.now() ^ Math.floor(Math.random() * 0x7fffffff)) >>> 0;
  const rng = createRng(seed);
  const profile = sampleProfile(rng);
  const multipath = buildMultipathModel(rng);

  const sampleRateHz = profile.sampleRateHz;
  const durationSeconds = profile.durationSeconds;
  const numFrames = Math.max(240, Math.round(sampleRateHz * durationSeconds));

  const timestampsSeconds: number[] = [];
  const amplitudeMatrix: number[][] = [];
  const phaseMatrix: number[][] = [];
  const amplitudeTimeseries: number[] = [];
  const rssiTimeseries: number[] = [];

  for (let frameIndex = 0; frameIndex < numFrames; frameIndex++) {
    const t = frameIndex / sampleRateHz;
    timestampsSeconds.push(round(t, 4));

    const frame = generateFrame(t, profile, multipath, rng);
    amplitudeMatrix.push(frame.amplitude);
    phaseMatrix.push(frame.phase);
    amplitudeTimeseries.push(round(mean(frame.amplitude), 6));

    const rssi =
      profile.rssiBase +
      2.1 * Math.sin(2 * Math.PI * 0.11 * t + multipath.driftPhase) +
      randomGaussian(rng, 0, 0.5);
    rssiTimeseries.push(round(rssi, 2));
  }

  const subcarrierProfile: number[] = [];
  for (let subcarrier = 0; subcarrier < NUM_SUBCARRIERS; subcarrier++) {
    let acc = 0;
    for (let frame = 0; frame < amplitudeMatrix.length; frame++) {
      acc += amplitudeMatrix[frame][subcarrier];
    }
    subcarrierProfile.push(round(acc / amplitudeMatrix.length, 6));
  }

  return {
    format: "proof_bundle",
    sampleRateHz,
    durationSeconds,
    numFrames,
    numSubcarriers: NUM_SUBCARRIERS,
    numAntennas: NUM_ANTENNAS,
    nodeIds: [profile.nodeId],
    scenarioHints: [`profile:${profile.id}`],
    timestampsSeconds,
    amplitudeTimeseries,
    amplitudeMatrix,
    phaseMatrix,
    subcarrierProfile,
    rssiTimeseries,
  };
}

