import { analyzeTemporalPose, estimatePoseFromCSI, extractVitals, type ParsedCSI, type PoseKeypoint } from "@/lib/csiProcessor";
import { InferenceEngineError, MalformedCsiFrameError } from "@/lib/scanErrors";

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
    activity: string;
    activityConfidence: number;
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

export interface InferenceResult {
  frame: InferenceFrame;
  analysis: InferenceAnalysis;
  inputSource: string;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message;
  return "Unknown processing error";
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
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
  return `You are a medical body composition AI assistant integrated into the Elfie healthcare platform. You have received the following data from a privacy-first WiFi CSI body scan (source: ${source}).

## Sensor Vitals
- Heart Rate: ${vitals.heartRateBpm} bpm
- Breathing Rate: ${vitals.breathingRateBpm} breaths/min
- HRV: ${vitals.hrv} ms
- Average Keypoint Confidence: ${avgConf.toFixed(2)}

## Body Measurements (from CSI spatial analysis)
- Estimated Height: ${bodyMetrics.estimatedHeightCm} cm
- Shoulder Width: ${bodyMetrics.shoulderWidthCm} cm
- Hip Width: ${bodyMetrics.hipWidthCm} cm
- Torso Length: ${bodyMetrics.torsoLengthCm} cm
- Left Arm: ${bodyMetrics.leftArmLengthCm} cm
- Right Arm: ${bodyMetrics.rightArmLengthCm} cm
- Left Leg: ${bodyMetrics.leftLegLengthCm} cm
- Shoulder-to-Hip Ratio: ${bodyMetrics.bmi_proxy}

Respond ONLY with a valid JSON object using this exact schema:
{
  "bodyFatPercent": <number>,
  "bodyFatClassification": "<Underfat|Healthy|Overfat|Obese>",
  "estimatedWaistCm": <number>,
  "clinicalSummary": "<2-3 sentence string>",
  "recommendations": ["<string>", "<string>", "<string>"],
  "postureNotes": "<string>"
}`;
}

async function callQwenAPI(prompt: string): Promise<Record<string, unknown> | null> {
  const apiKey = process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY;
  if (!apiKey) return null;

  const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen-plus",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
      response_format: { type: "json_object" },
    }),
  });

  if (!response.ok) return null;
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return null;
  return JSON.parse(content) as Record<string, unknown>;
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

  let bodyFatClassification: string;
  let classColor: string;
  if (bodyFatPercent < 10) {
    bodyFatClassification = "Underfat";
    classColor = "amber";
  } else if (bodyFatPercent < 25) {
    bodyFatClassification = "Healthy";
    classColor = "emerald";
  } else if (bodyFatPercent < 32) {
    bodyFatClassification = "Overfat";
    classColor = "orange";
  } else {
    bodyFatClassification = "Obese";
    classColor = "rose";
  }

  const estimatedWaistCm = Math.round(hipWidthCm * 1.6 + (bodyFatPercent - 15) * 0.5);

  return {
    bodyFatPercent,
    bodyFatClassification,
    classColor,
    estimatedWaistCm,
    clinicalSummary: `Based on CSI skeletal analysis, estimated body fat is ${bodyFatPercent}% (${bodyFatClassification}). Heart rate of ${heartRateBpm} bpm and breathing rate of ${breathingRateBpm} rpm are ${heartRateBpm > 90 ? "slightly elevated" : "within normal range"}. HRV of ${hrv} ms suggests ${hrv > 40 ? "good" : "moderate"} autonomic regulation.`,
    recommendations: [
      bodyFatPercent > 25
        ? "Incorporate 30 min moderate aerobic exercise (walking, cycling) 4–5 days per week."
        : "Maintain current activity levels and log weekly scans in Elfie to track trends.",
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

export async function runInferenceEngine(parsedCsi: ParsedCSI, inputSource: string): Promise<InferenceResult> {
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
  const bodyMetrics = stabilizeBodyMetrics(computeBodyMetrics(keypoints));

  const vitals = {
    heartRateBpm: extractedVitals.heartRateBpm,
    breathingRateBpm: extractedVitals.breathingRateBpm,
    hrv: extractedVitals.hrv,
  };

  const avgConf = keypoints.reduce((sum, keypoint) => sum + keypoint.confidence, 0) / keypoints.length;
  const prompt = buildPrompt(vitals, bodyMetrics, avgConf, inputSource);

  let analysis: InferenceAnalysis;
  try {
    const qwenResult = await callQwenAPI(prompt);
    if (qwenResult) {
      const classMap: Record<string, string> = {
        Underfat: "amber",
        Healthy: "emerald",
        Overfat: "orange",
        Obese: "rose",
      };
      analysis = {
        bodyFatPercent: Number(qwenResult.bodyFatPercent),
        bodyFatClassification: String(qwenResult.bodyFatClassification ?? "Healthy"),
        classColor: classMap[String(qwenResult.bodyFatClassification)] ?? "slate",
        estimatedWaistCm: Number(qwenResult.estimatedWaistCm),
        clinicalSummary: String(qwenResult.clinicalSummary ?? ""),
        recommendations: Array.isArray(qwenResult.recommendations)
          ? qwenResult.recommendations.map((item) => String(item))
          : [],
        postureNotes: String(qwenResult.postureNotes ?? ""),
        source: "qwen",
      };
    } else {
      analysis = ruleBasedAnalysis(vitals, bodyMetrics);
    }
  } catch (error) {
    // Explicit boundary around external model calls and downstream parsing.
    analysis = ruleBasedAnalysis(vitals, bodyMetrics);
    if (!analysis) {
      throw new InferenceEngineError("Failed to generate scan analysis.", {
        reason: toErrorMessage(error),
      });
    }
  }

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
      activity: temporalPose.activity,
      activityConfidence: temporalPose.activityConfidence,
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
  };
}

