import { analyzeTemporalPose, estimatePoseFromCSI, extractVitals, type ParsedCSI, type PoseKeypoint } from "@/lib/csiProcessor";
import {
  InferenceEngineError,
  MalformedCsiFrameError,
  ScanServiceError,
  SignalQualityError,
} from "@/lib/scanErrors";
import {
  normalizeAnalysisModelId,
  runAnalysisModel,
} from "@/lib/analysisModels";

export interface ComputedBodyMetrics {
  estimatedHeightCm: number;
  shoulderWidthCm: number;
  hipWidthCm: number;
  torsoLengthCm: number;
  leftArmLengthCm: number;
  rightArmLengthCm: number;
  leftLegLengthCm: number;
  bmi_proxy: number;
}

export interface InferenceFrame {
  timestamp: number;
  nodeId: string;
  channel: number;
  subcarriers: number;
  rssi: number;
  keypoints: PoseKeypoint[];
  vitals: {
    heartRate: number;
    breathingRate: number;
    hrv: number;
  };
  bodyMetrics: ComputedBodyMetrics;
  keypointSequence: {
    t: number;
    keypoints: PoseKeypoint[];
    confidence: number;
    motionScore: number;
  }[];
  temporal: {
    dominantMotionHz: number;
    breathingHz: number;
    motionEnergy: number;
    phaseStability: number;
    fps: number;
    sequenceLength: number;
    durationSeconds: number;
  };
  csiMeta: {
    format: string;
    numFrames: number;
    durationSeconds: number;
    sampleRateHz: number;
    numAntennas: number;
    numSubcarriers: number;
  };
}

export interface InferenceAnalysis {
  bodyFatPercent: number;
  bodyFatClassification: string;
  classColor: string;
  estimatedWaistCm: number;
  clinicalSummary: string;
  recommendations: string[];
  postureNotes: string;
  source: "qwen" | "rule-based";
}

export interface ScanQualityComponents {
  frameCoverage: number;
  sampleRate: number;
  rssiStrength: number;
  temporalStability: number;
  motionConsistency: number;
  nodeCoverage: number;
}

export interface InterferenceDiagnostics {
  score: number;
  primaryPeakPower: number;
  secondaryPeakPower: number;
  spectralAmbiguity: number;
  multiPersonLikely: boolean;
}

export interface ScanDiagnostics {
  qualityScore: number;
  qualityGrade: "A" | "B" | "C" | "D";
  qualityGatePassed: boolean;
  qualityComponents: ScanQualityComponents;
  interferenceScore: number;
  multiPersonLikely: boolean;
  warnings: string[];
  fusion?: ParsedCSI["fusion"];
  calibration: {
    profileId?: string;
    baselineApplied: boolean;
    driftCompensationStrength: number;
  };
}

export interface CalibrationAdjustments {
  profileId?: string;
  heartRateBiasBpm: number;
  breathingRateBiasBpm: number;
  hrvBiasMs: number;
  shoulderScale: number;
  hipScale: number;
  torsoScale: number;
  leftArmScale: number;
  rightArmScale: number;
  leftLegScale: number;
  bodyFatBiasPercent: number;
  waistBiasCm: number;
}

export interface InferenceOptions {
  calibration?: CalibrationAdjustments;
  qualityGateMin?: number;
  baselineApplied?: boolean;
  driftCompensationStrength?: number;
  analysisModel?: string | null;
}

export interface InferenceResult {
  frame: InferenceFrame;
  analysis: InferenceAnalysis;
  inputSource: string;
  diagnostics: ScanDiagnostics;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown processing error";
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function resolveQualityGateMin(override?: number): number {
  if (typeof override === "number" && Number.isFinite(override)) {
    return clamp(override, 0.1, 0.95);
  }
  const envValue = Number(process.env.SCAN_QUALITY_GATE_MIN);
  if (Number.isFinite(envValue)) return clamp(envValue, 0.1, 0.95);
  return 0.38;
}

function classifyBodyFat(bodyFatPercent: number): { classification: string; color: string } {
  if (bodyFatPercent < 10) return { classification: "Underfat", color: "amber" };
  if (bodyFatPercent < 25) return { classification: "Healthy", color: "emerald" };
  if (bodyFatPercent < 32) return { classification: "Overfat", color: "orange" };
  return { classification: "Obese", color: "rose" };
}

function applyCalibrationToVitals(
  vitals: { heartRateBpm: number; breathingRateBpm: number; hrv: number },
  calibration?: CalibrationAdjustments
): { heartRateBpm: number; breathingRateBpm: number; hrv: number } {
  if (!calibration) return vitals;
  return {
    heartRateBpm: Math.round(clamp(vitals.heartRateBpm + calibration.heartRateBiasBpm, 40, 140)),
    breathingRateBpm: Math.round(clamp(vitals.breathingRateBpm + calibration.breathingRateBiasBpm, 6, 36)),
    hrv: Math.round(clamp(vitals.hrv + calibration.hrvBiasMs, 8, 160)),
  };
}

function applyCalibrationToBodyMetrics(
  metrics: ComputedBodyMetrics,
  calibration?: CalibrationAdjustments
): ComputedBodyMetrics {
  if (!calibration) return metrics;
  return stabilizeBodyMetrics({
    ...metrics,
    shoulderWidthCm: Math.round(metrics.shoulderWidthCm * calibration.shoulderScale),
    hipWidthCm: Math.round(metrics.hipWidthCm * calibration.hipScale),
    torsoLengthCm: Math.round(metrics.torsoLengthCm * calibration.torsoScale),
    leftArmLengthCm: Math.round(metrics.leftArmLengthCm * calibration.leftArmScale),
    rightArmLengthCm: Math.round(metrics.rightArmLengthCm * calibration.rightArmScale),
    leftLegLengthCm: Math.round(metrics.leftLegLengthCm * calibration.leftLegScale),
  });
}

function applyCalibrationToAnalysis(
  analysis: InferenceAnalysis,
  calibration?: CalibrationAdjustments
): InferenceAnalysis {
  if (!calibration) return analysis;
  const adjustedBodyFat = round(clamp(analysis.bodyFatPercent + calibration.bodyFatBiasPercent, 5, 45), 1);
  const adjustedWaist = Math.round(clamp(analysis.estimatedWaistCm + calibration.waistBiasCm, 40, 180));
  const classification = classifyBodyFat(adjustedBodyFat);
  const summarySuffix =
    calibration.bodyFatBiasPercent !== 0 || calibration.waistBiasCm !== 0
      ? ` Calibration-adjusted estimate: body fat ${adjustedBodyFat}% and waist ${adjustedWaist} cm.`
      : "";
  return {
    ...analysis,
    bodyFatPercent: adjustedBodyFat,
    estimatedWaistCm: adjustedWaist,
    bodyFatClassification: classification.classification,
    classColor: classification.color,
    clinicalSummary: `${analysis.clinicalSummary}${summarySuffix}`.trim(),
  };
}

function computeSpectralPeaks(signal: number[], sampleRateHz: number): {
  primaryPower: number;
  secondaryPower: number;
} {
  if (signal.length < 24 || sampleRateHz <= 0) {
    return { primaryPower: 0, secondaryPower: 0 };
  }
  const centered = signal.map((value) => value - mean(signal));
  const n = centered.length;
  const minHz = 0.08;
  const maxHz = Math.min(2.5, sampleRateHz / 2 - 0.01);
  const startBin = Math.max(1, Math.floor((minHz * n) / sampleRateHz));
  const endBin = Math.max(startBin + 1, Math.floor((maxHz * n) / sampleRateHz));

  let primaryPower = 0;
  let secondaryPower = 0;
  for (let k = startBin; k <= endBin; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const phi = (2 * Math.PI * k * t) / n;
      re += centered[t] * Math.cos(phi);
      im -= centered[t] * Math.sin(phi);
    }
    const power = re * re + im * im;
    if (power >= primaryPower) {
      secondaryPower = primaryPower;
      primaryPower = power;
    } else if (power > secondaryPower) {
      secondaryPower = power;
    }
  }

  return { primaryPower, secondaryPower };
}

function computeInterferenceDiagnostics(
  parsedCsi: ParsedCSI,
  temporalPose: ReturnType<typeof analyzeTemporalPose>
): InterferenceDiagnostics {
  const peaks = computeSpectralPeaks(parsedCsi.amplitudeTimeseries, parsedCsi.sampleRateHz);
  const spectralAmbiguity =
    peaks.primaryPower <= 0 ? 0 : clamp(peaks.secondaryPower / peaks.primaryPower, 0, 1);
  const phaseDisorder = clamp((0.62 - temporalPose.phaseStability) / 0.62, 0, 1);
  const energyPressure = clamp((temporalPose.motionEnergy - 0.08) / 0.14, 0, 1);
  const score = clamp(spectralAmbiguity * 0.52 + phaseDisorder * 0.30 + energyPressure * 0.18, 0, 1);
  const multiPersonLikely = score >= 0.72 && spectralAmbiguity >= 0.58;
  return {
    score: round(score, 4),
    primaryPeakPower: round(peaks.primaryPower, 4),
    secondaryPeakPower: round(peaks.secondaryPower, 4),
    spectralAmbiguity: round(spectralAmbiguity, 4),
    multiPersonLikely,
  };
}

function computeScanDiagnostics(
  parsedCsi: ParsedCSI,
  temporalPose: ReturnType<typeof analyzeTemporalPose>,
  interference: InterferenceDiagnostics,
  options?: InferenceOptions
): ScanDiagnostics {
  const meanRssi = mean(parsedCsi.rssiTimeseries);
  const components: ScanQualityComponents = {
    frameCoverage: round(clamp(parsedCsi.numFrames / 260, 0, 1), 4),
    sampleRate: round(clamp(parsedCsi.sampleRateHz / 95, 0, 1), 4),
    rssiStrength: round(clamp((meanRssi + 92) / 38, 0, 1), 4),
    temporalStability: round(clamp(temporalPose.phaseStability, 0, 1), 4),
    motionConsistency: round(clamp(1 - Math.abs(temporalPose.motionEnergy - 0.06) / 0.16, 0, 1), 4),
    nodeCoverage: round(
      parsedCsi.fusion?.enabled
        ? clamp((parsedCsi.fusion.nodeCount + 1) / 3, 0.45, 1)
        : 0.86,
      4
    ),
  };

  const qualityScore = round(
    clamp(
      components.frameCoverage * 0.20 +
        components.sampleRate * 0.15 +
        components.rssiStrength * 0.20 +
        components.temporalStability * 0.20 +
        components.motionConsistency * 0.15 +
        components.nodeCoverage * 0.10 -
        interference.score * 0.18,
      0,
      1
    ),
    4
  );

  const qualityGrade: ScanDiagnostics["qualityGrade"] =
    qualityScore >= 0.82 ? "A" : qualityScore >= 0.65 ? "B" : qualityScore >= 0.48 ? "C" : "D";

  const warnings: string[] = [];
  if (qualityScore < 0.55) warnings.push("Signal quality is low; scan confidence is reduced.");
  if (components.rssiStrength < 0.42) warnings.push("Weak RF strength detected.");
  if (components.temporalStability < 0.46) warnings.push("Temporal phase instability indicates interference.");
  if (interference.multiPersonLikely) warnings.push("Possible multi-person or environmental interference detected.");
  if (parsedCsi.fusion?.enabled) {
    warnings.push(`Multi-node fusion active across ${parsedCsi.fusion.nodeCount} nodes.`);
  }

  const gateMin = resolveQualityGateMin(options?.qualityGateMin);
  const gatePassed = qualityScore >= gateMin && !(interference.score > 0.93 && qualityScore < 0.62);

  return {
    qualityScore,
    qualityGrade,
    qualityGatePassed: gatePassed,
    qualityComponents: components,
    interferenceScore: interference.score,
    multiPersonLikely: interference.multiPersonLikely,
    warnings,
    fusion: parsedCsi.fusion,
    calibration: {
      profileId: options?.calibration?.profileId,
      baselineApplied: Boolean(options?.baselineApplied),
      driftCompensationStrength: options?.driftCompensationStrength ?? 0,
    },
  };
}

function computeBodyMetrics(keypoints: { point: string; x: number; y: number }[], refHeightCm = 170): ComputedBodyMetrics {
  const kp = Object.fromEntries(keypoints.map((k) => [k.point, k]));
  const scale = refHeightCm;

  const dist = (a: string, b: string) => {
    if (!kp[a] || !kp[b]) return 0;
    const dx = (kp[a].x - kp[b].x) * scale;
    const dy = (kp[a].y - kp[b].y) * scale;
    return Math.round(Math.sqrt(dx * dx + dy * dy));
  };

  const heightPx = Math.abs(kp["nose"].y - kp["left_ankle"].y);
  const estimatedHeightCm = Math.round(170 + (heightPx - 0.86) * 20);

  return {
    estimatedHeightCm: Math.min(210, Math.max(140, estimatedHeightCm)),
    shoulderWidthCm: dist("left_shoulder", "right_shoulder"),
    hipWidthCm: dist("left_hip", "right_hip"),
    torsoLengthCm: dist("left_shoulder", "left_hip"),
    leftArmLengthCm: dist("left_shoulder", "left_elbow") + dist("left_elbow", "left_wrist"),
    rightArmLengthCm: dist("right_shoulder", "right_elbow") + dist("right_elbow", "right_wrist"),
    leftLegLengthCm: dist("left_hip", "left_knee") + dist("left_knee", "left_ankle"),
    bmi_proxy: parseFloat(
      (dist("left_shoulder", "right_shoulder") / Math.max(dist("left_hip", "right_hip"), 1)).toFixed(2)
    ),
  };
}

function stabilizeBodyMetrics(metrics: ComputedBodyMetrics): ComputedBodyMetrics {
  const stabilized = {
    ...metrics,
    estimatedHeightCm: Math.round(clamp(metrics.estimatedHeightCm, 145, 205)),
    shoulderWidthCm: Math.round(clamp(metrics.shoulderWidthCm, 30, 62)),
    hipWidthCm: Math.round(clamp(metrics.hipWidthCm, 28, 62)),
    torsoLengthCm: Math.round(clamp(metrics.torsoLengthCm, 36, 82)),
    leftArmLengthCm: Math.round(clamp(metrics.leftArmLengthCm, 42, 92)),
    rightArmLengthCm: Math.round(clamp(metrics.rightArmLengthCm, 42, 92)),
    leftLegLengthCm: Math.round(clamp(metrics.leftLegLengthCm, 58, 128)),
  };

  return {
    ...stabilized,
    bmi_proxy: parseFloat(clamp(stabilized.shoulderWidthCm / Math.max(stabilized.hipWidthCm, 1), 0.72, 1.48).toFixed(2)),
  };
}

function buildPrompt(
  vitals: { heartRateBpm: number; breathingRateBpm: number; hrv: number },
  bodyMetrics: ComputedBodyMetrics,
  avgConf: number,
  source: string
): string {
  return `You are the clinical interpretation assistant for a privacy-first WiFi CSI body scan.
You must only use the provided metrics. Do not invent extra measurements and do not diagnose diseases.
Keep recommendations practical, cautious, and non-prescriptive.

Scan source: ${source}

## Signal + confidence
- Average keypoint confidence: ${avgConf.toFixed(2)}

## Extracted vitals
- Heart Rate: ${vitals.heartRateBpm} bpm
- Breathing Rate: ${vitals.breathingRateBpm} breaths/min
- HRV: ${vitals.hrv} ms

## Body metrics (CSI-derived geometry)
- Estimated Height: ${bodyMetrics.estimatedHeightCm} cm
- Shoulder Width: ${bodyMetrics.shoulderWidthCm} cm
- Hip Width: ${bodyMetrics.hipWidthCm} cm
- Torso Length: ${bodyMetrics.torsoLengthCm} cm
- Left Arm: ${bodyMetrics.leftArmLengthCm} cm
- Right Arm: ${bodyMetrics.rightArmLengthCm} cm
- Left Leg: ${bodyMetrics.leftLegLengthCm} cm
- Shoulder-to-Hip Ratio: ${bodyMetrics.bmi_proxy}

Output requirements:
1. Return JSON only (no markdown or prose before/after).
2. Keep "clinicalSummary" to 2-3 short sentences.
3. "recommendations" must contain exactly 3 concise items.
4. Keep values realistic for an adult wellness scan.
5. bodyFatClassification must be one of: Underfat, Healthy, Overfat, Obese.

Return this exact schema:
{
  "bodyFatPercent": <number>,
  "bodyFatClassification": "<Underfat|Healthy|Overfat|Obese>",
  "estimatedWaistCm": <number>,
  "clinicalSummary": "<2-3 sentence string>",
  "recommendations": ["<string>", "<string>", "<string>"],
  "postureNotes": "<string>"
}`;
}

function normalizeRecommendations(items: unknown, fallbackBodyFat: number): string[] {
  const defaults = [
    fallbackBodyFat > 25
      ? "Increase moderate activity and maintain a consistent sleep schedule."
      : "Maintain your current wellness routine and continue periodic tracking.",
    "Use weekly trend tracking to compare HR, breathing rate, and HRV together.",
    "Seek clinician guidance if persistent abnormal trends appear across multiple scans.",
  ];
  if (!Array.isArray(items)) return defaults;
  const cleaned = items
    .map((item) => String(item).trim())
    .filter((item) => item.length > 0)
    .slice(0, 3);
  while (cleaned.length < 3) cleaned.push(defaults[cleaned.length]);
  return cleaned;
}

function ruleBasedAnalysis(
  vitals: { heartRateBpm: number; breathingRateBpm: number; hrv: number },
  bodyMetrics: ComputedBodyMetrics
): InferenceAnalysis {
  const { shoulderWidthCm, hipWidthCm, torsoLengthCm, estimatedHeightCm } = bodyMetrics;
  const { heartRateBpm, hrv, breathingRateBpm } = vitals;

  const torsoRatio = torsoLengthCm / estimatedHeightCm;
  const shoulderHipRatio = shoulderWidthCm / Math.max(hipWidthCm, 1);

  let fatBase = 15 + (1 / shoulderHipRatio) * 9 + torsoRatio * 6;
  if (heartRateBpm > 85) fatBase += 2.5;
  if (hrv < 30) fatBase += 1.5;
  const bodyFatPercent = Math.max(5, Math.min(45, parseFloat(fatBase.toFixed(1))));
  const bodyFatClass = classifyBodyFat(bodyFatPercent);

  const estimatedWaistCm = Math.round(hipWidthCm * 1.6 + (bodyFatPercent - 15) * 0.5);

  return {
    bodyFatPercent,
    bodyFatClassification: bodyFatClass.classification,
    classColor: bodyFatClass.color,
    estimatedWaistCm,
    clinicalSummary: `Based on CSI skeletal analysis, estimated body fat is ${bodyFatPercent}% (${bodyFatClass.classification}). Heart rate of ${heartRateBpm} bpm and breathing rate of ${breathingRateBpm} rpm are ${heartRateBpm > 90 ? "slightly elevated" : "within normal range"}. HRV of ${hrv} ms suggests ${hrv > 40 ? "good" : "moderate"} autonomic regulation.`,
    recommendations: [
      bodyFatPercent > 25
        ? "Incorporate 30 min moderate aerobic exercise 4–5 days per week."
        : "Maintain a consistent wellness routine and log weekly scans in Elfie to track trends.",
      hrv < 35
        ? "Practice diaphragmatic breathing or mindfulness to improve HRV and parasympathetic tone."
        : "Your HRV is healthy. Track it weekly via Elfie to detect early stress or recovery issues.",
      "Log today's scan in Elfie to build a longitudinal body composition timeline.",
    ],
    postureNotes:
      shoulderWidthCm > hipWidthCm * 1.15
        ? "Broad shoulder frame detected. Maintain proper posture alignment during prolonged seated work."
        : "Balanced skeletal proportions. No significant postural asymmetry detected.",
    source: "rule-based",
  };
}

export async function runInferenceEngine(
  parsedCsi: ParsedCSI,
  inputSource: string,
  options?: InferenceOptions
): Promise<InferenceResult> {
  if (parsedCsi.numFrames < 4 || parsedCsi.numSubcarriers < 8) {
    throw new MalformedCsiFrameError("CSI payload is too short for inference.", {
      numFrames: parsedCsi.numFrames,
      numSubcarriers: parsedCsi.numSubcarriers,
    });
  }

  let extractedVitals: ReturnType<typeof extractVitals>;
  let poseData: ReturnType<typeof estimatePoseFromCSI>;
  let temporalPose: ReturnType<typeof analyzeTemporalPose>;

  try {
    extractedVitals = extractVitals(parsedCsi);
    poseData = estimatePoseFromCSI(parsedCsi);
    temporalPose = analyzeTemporalPose(parsedCsi);
  } catch (error) {
    throw new MalformedCsiFrameError("RuVector CSI processing failed.", {
      reason: toErrorMessage(error),
    });
  }

  const keypointSequence = temporalPose.sequence;
  const representativeFrame = keypointSequence[Math.floor(keypointSequence.length / 2)];
  const keypoints = representativeFrame?.keypoints ?? poseData.keypoints;
  const rawBodyMetrics = stabilizeBodyMetrics(computeBodyMetrics(keypoints));

  const rawVitals = {
    heartRateBpm: extractedVitals.heartRateBpm,
    breathingRateBpm: extractedVitals.breathingRateBpm,
    hrv: extractedVitals.hrv,
  };
  const vitals = applyCalibrationToVitals(rawVitals, options?.calibration);
  const bodyMetrics = applyCalibrationToBodyMetrics(rawBodyMetrics, options?.calibration);

  const interference = computeInterferenceDiagnostics(parsedCsi, temporalPose);
  const diagnostics = computeScanDiagnostics(parsedCsi, temporalPose, interference, options);
  if (!diagnostics.qualityGatePassed) {
    throw new SignalQualityError("Signal quality is too low for reliable inference.", {
      qualityScore: diagnostics.qualityScore,
      qualityGrade: diagnostics.qualityGrade,
      qualityGateMin: resolveQualityGateMin(options?.qualityGateMin),
      interferenceScore: diagnostics.interferenceScore,
      warnings: diagnostics.warnings,
    });
  }

  const avgConf = keypoints.reduce((sum, keypoint) => sum + keypoint.confidence, 0) / keypoints.length;
  const prompt = buildPrompt(vitals, bodyMetrics, avgConf, inputSource);

  let analysis: InferenceAnalysis;
  const selectedModel = normalizeAnalysisModelId(options?.analysisModel);
  if (selectedModel === "none") {
    analysis = ruleBasedAnalysis(vitals, bodyMetrics);
  } else {
    try {
      const modelResult = await runAnalysisModel(selectedModel, {
        prompt,
      });
      if (!modelResult) {
        analysis = ruleBasedAnalysis(vitals, bodyMetrics);
      } else {
        const qwenResult = modelResult.content;
        const classMap: Record<string, string> = {
          Underfat: "amber",
          Healthy: "emerald",
          Overfat: "orange",
          Obese: "rose",
        };
        const rawBodyFat = Number(qwenResult.bodyFatPercent);
        const safeBodyFat = clamp(Number.isFinite(rawBodyFat) ? rawBodyFat : 22, 5, 45);
        const safeClass = classifyBodyFat(safeBodyFat);
        const rawWaist = Number(qwenResult.estimatedWaistCm);
        const summary = String(qwenResult.clinicalSummary ?? "").trim();
        analysis = {
          bodyFatPercent: safeBodyFat,
          bodyFatClassification: String(qwenResult.bodyFatClassification ?? safeClass.classification),
          classColor: classMap[String(qwenResult.bodyFatClassification)] ?? safeClass.color,
          estimatedWaistCm: Math.round(Number.isFinite(rawWaist) ? rawWaist : bodyMetrics.hipWidthCm * 1.6),
          clinicalSummary:
            summary.length > 0
              ? summary
              : `Estimated body fat is ${safeBodyFat}% (${safeClass.classification}) with vitals interpreted from CSI wellness metrics.`,
          recommendations: normalizeRecommendations(qwenResult.recommendations, safeBodyFat),
          postureNotes:
            String(qwenResult.postureNotes ?? "").trim() ||
            "Maintain neutral posture during repeated scans for stable trend quality.",
          source: "qwen",
        };
      }
    } catch (error) {
      if (error instanceof ScanServiceError) throw error;
      throw new InferenceEngineError("Selected AI analysis model failed.", {
        selectedModel,
        reason: toErrorMessage(error),
        causeName: error instanceof Error ? error.name : undefined,
      });
    }
  }
  analysis = applyCalibrationToAnalysis(analysis, options?.calibration);

  const frame: InferenceFrame = {
    timestamp: Date.now(),
    nodeId: `Node(s): ${parsedCsi.nodeIds.join(", ")}`,
    channel: 11,
    subcarriers: parsedCsi.numSubcarriers,
    rssi: Math.round(parsedCsi.rssiTimeseries.reduce((sum, value) => sum + value, 0) / Math.max(parsedCsi.rssiTimeseries.length, 1)),
    keypoints,
    vitals: {
      heartRate: vitals.heartRateBpm,
      breathingRate: vitals.breathingRateBpm,
      hrv: vitals.hrv,
    },
    bodyMetrics,
    keypointSequence,
    temporal: {
      dominantMotionHz: temporalPose.dominantMotionHz,
      breathingHz: temporalPose.breathingHz,
      motionEnergy: temporalPose.motionEnergy,
      phaseStability: temporalPose.phaseStability,
      fps: temporalPose.fps,
      sequenceLength: keypointSequence.length,
      durationSeconds: parseFloat(
        (keypointSequence[keypointSequence.length - 1]?.t ?? parsedCsi.durationSeconds).toFixed(2)
      ),
    },
    csiMeta: {
      format: parsedCsi.format,
      numFrames: parsedCsi.numFrames,
      durationSeconds: parseFloat(parsedCsi.durationSeconds.toFixed(2)),
      sampleRateHz: parseFloat(parsedCsi.sampleRateHz.toFixed(1)),
      numAntennas: parsedCsi.numAntennas,
      numSubcarriers: parsedCsi.numSubcarriers,
    },
  };

  return {
    frame,
    analysis,
    inputSource,
    diagnostics,
  };
}

