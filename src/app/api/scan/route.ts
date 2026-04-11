import { NextRequest, NextResponse } from "next/server";
import { parseCsiFile, extractVitals, estimatePoseFromCSI } from "@/lib/csiProcessor";
import { generateRuViewFrame } from "@/lib/ruviewSimulator";
import type { ParsedCSI } from "@/lib/csiProcessor";

// ─── Body metric computation from CSI-derived keypoints ──────────────────────

function computeBodyMetrics(keypoints: { point: string; x: number; y: number }[], refHeightCm = 170) {
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
    hipWidthCm:      dist("left_hip", "right_hip"),
    torsoLengthCm:   dist("left_shoulder", "left_hip"),
    leftArmLengthCm: dist("left_shoulder", "left_elbow") + dist("left_elbow", "left_wrist"),
    rightArmLengthCm: dist("right_shoulder", "right_elbow") + dist("right_elbow", "right_wrist"),
    leftLegLengthCm: dist("left_hip", "left_knee") + dist("left_knee", "left_ankle"),
    bmi_proxy: parseFloat(
      (dist("left_shoulder", "right_shoulder") / Math.max(dist("left_hip", "right_hip"), 1)).toFixed(2)
    ),
  };
}

// ─── Qwen AI prompt ───────────────────────────────────────────────────────────

function buildPrompt(vitals: { heartRateBpm: number; breathingRateBpm: number; hrv: number }, bodyMetrics: ReturnType<typeof computeBodyMetrics>, avgConf: number, source: string): string {
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

  try {
    const response = await fetch(
      "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions",
      {
        method: "POST",
        headers: { "Authorization": `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "qwen-plus",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.3,
          response_format: { type: "json_object" },
        }),
      }
    );
    if (!response.ok) return null;
    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    return content ? JSON.parse(content) : null;
  } catch {
    return null;
  }
}

function ruleBasedAnalysis(vitals: { heartRateBpm: number; breathingRateBpm: number; hrv: number }, bodyMetrics: ReturnType<typeof computeBodyMetrics>) {
  const { shoulderWidthCm, hipWidthCm, torsoLengthCm, estimatedHeightCm } = bodyMetrics;
  const { heartRateBpm, hrv, breathingRateBpm } = vitals;

  const torsoRatio = torsoLengthCm / estimatedHeightCm;
  const shoulderHipRatio = shoulderWidthCm / Math.max(hipWidthCm, 1);

  let fatBase = 15 + (1 / shoulderHipRatio) * 9 + torsoRatio * 6;
  if (heartRateBpm > 85) fatBase += 2.5;
  if (hrv < 30) fatBase += 1.5;
  const bodyFatPercent = Math.max(5, Math.min(45, parseFloat(fatBase.toFixed(1))));

  let bodyFatClassification: string, classColor: string;
  if (bodyFatPercent < 10)      { bodyFatClassification = "Underfat"; classColor = "amber"; }
  else if (bodyFatPercent < 25) { bodyFatClassification = "Healthy"; classColor = "emerald"; }
  else if (bodyFatPercent < 32) { bodyFatClassification = "Overfat"; classColor = "orange"; }
  else                          { bodyFatClassification = "Obese"; classColor = "rose"; }

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
    postureNotes: shoulderWidthCm > hipWidthCm * 1.15
      ? "Broad shoulder frame detected. Maintain proper posture alignment during prolonged seated work."
      : "Balanced skeletal proportions. No significant postural asymmetry detected.",
    source: "rule-based" as const,
  };
}

// ─── Main Route ───────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") ?? "";
    let parsedCsi: ParsedCSI | null = null;
    let inputSource = "simulated";

    // ── Mode A: CSI file upload ──
    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("csiFile") as File | null;

      if (!file) {
        return NextResponse.json({ success: false, error: "No file provided" }, { status: 400 });
      }

      const text = await file.text();
      try {
        parsedCsi = parseCsiFile(text);
        inputSource = `file:${parsedCsi.format}`;
      } catch (err) {
        return NextResponse.json({ success: false, error: `File parse error: ${err}` }, { status: 422 });
      }
    }

    // ── Mode B: Simulated (default, POST with no body or {mode:"simulate"}) ──
    let frame;
    let vitals;
    let keypoints;
    let bodyMetrics;

    if (parsedCsi) {
      // Real DSP pipeline from uploaded file
      const extractedVitals = extractVitals(parsedCsi);
      const poseData = estimatePoseFromCSI(parsedCsi);

      vitals = {
        heartRate: extractedVitals.heartRateBpm,
        breathingRate: extractedVitals.breathingRateBpm,
        hrv: extractedVitals.hrv,
      };
      keypoints = poseData.keypoints;
      bodyMetrics = computeBodyMetrics(keypoints);

      frame = {
        timestamp: Date.now(),
        nodeId: `Node(s): ${parsedCsi.nodeIds.join(", ")}`,
        channel: 11,
        subcarriers: parsedCsi.numSubcarriers,
        rssi: Math.round(parsedCsi.rssiTimeseries.reduce((s, v) => s + v, 0) / Math.max(parsedCsi.rssiTimeseries.length, 1)),
        keypoints,
        vitals,
        bodyMetrics,
        csiMeta: {
          format: parsedCsi.format,
          numFrames: parsedCsi.numFrames,
          durationSeconds: parseFloat(parsedCsi.durationSeconds.toFixed(2)),
          sampleRateHz: parseFloat(parsedCsi.sampleRateHz.toFixed(1)),
          numAntennas: parsedCsi.numAntennas,
          numSubcarriers: parsedCsi.numSubcarriers,
        },
      };
    } else {
      // Simulated mode: use the random generator
      const simFrame = generateRuViewFrame();
      frame = simFrame;
      vitals = {
        heartRate: simFrame.vitals.heartRate,
        breathingRate: simFrame.vitals.breathingRate,
        hrv: simFrame.vitals.hrv,
      };
      keypoints = simFrame.keypoints;
      bodyMetrics = simFrame.bodyMetrics;
    }

    // Normalise vitals to a single shape for the analysis functions
    type AnyVitals = { heartRate?: number; heartRateBpm?: number; breathingRate?: number; breathingRateBpm?: number; hrv: number };
    const v = vitals as AnyVitals;
    const normVitals = {
      heartRateBpm: (v.heartRate ?? v.heartRateBpm) as number,
      breathingRateBpm: (v.breathingRate ?? v.breathingRateBpm) as number,
      hrv: v.hrv,
    };

    // ── Qwen AI or fallback ──
    const avgConf = keypoints.reduce((s: number, k: { confidence: number }) => s + k.confidence, 0) / keypoints.length;
    const prompt = buildPrompt(normVitals, bodyMetrics, avgConf, inputSource);

    let analysis: Record<string, unknown>;
    const qwenResult = await callQwenAPI(prompt);

    if (qwenResult) {
      const classMap: Record<string, string> = {
        Underfat: "amber", Healthy: "emerald", Overfat: "orange", Obese: "rose",
      };
      analysis = {
        ...qwenResult,
        classColor: classMap[qwenResult.bodyFatClassification as string] ?? "slate",
        source: "qwen",
      };
    } else {
      analysis = ruleBasedAnalysis(normVitals, bodyMetrics);
    }

    return NextResponse.json({ success: true, frame, analysis, inputSource });
  } catch (error) {
    console.error("Scan API error:", error);
    return NextResponse.json({ success: false, error: "Internal server error" }, { status: 500 });
  }
}
