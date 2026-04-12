import { getServerDb, parseJsonField, stringifyJson } from "@/lib/serverDb";
import type { InferenceResult } from "@/lib/inferenceEngine";

export interface TrendRecord {
  recordId: string;
  timestampMs: number;
  inputSource: string;
  bodyFatPercent: number;
  heartRate: number;
  breathingRate: number;
  hrv: number;
  dominantMotionHz: number;
  motionEnergy: number;
  phaseStability: number;
  qualityScore: number;
  qualityGrade: string;
  interferenceScore: number;
  multiPersonLikely: boolean;
  inferenceSource: string;
  flags: string[];
}

export interface TrendSummary {
  windowDays: number;
  totalScans: number;
  byInputSource: Record<string, number>;
  firstTimestampMs: number | null;
  lastTimestampMs: number | null;
  deltas: {
    bodyFatPercent: number | null;
    heartRate: number | null;
    breathingRate: number | null;
    hrv: number | null;
  };
  latest: TrendRecord | null;
  anomalies: string[];
  riskLevel: "low" | "moderate" | "high";
}

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function round(value: number, digits = 3): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function toTrendRecord(row: {
  record_id: string;
  timestamp_ms: number;
  input_source: string;
  body_fat_percent: number;
  heart_rate: number;
  breathing_rate: number;
  hrv: number;
  dominant_motion_hz: number;
  motion_energy: number;
  phase_stability: number;
  quality_score: number;
  quality_grade: string;
  interference_score: number;
  multi_person_likely: number;
  inference_source: string;
  flags_json: string | null;
}): TrendRecord {
  return {
    recordId: row.record_id,
    timestampMs: row.timestamp_ms,
    inputSource: row.input_source,
    bodyFatPercent: row.body_fat_percent,
    heartRate: row.heart_rate,
    breathingRate: row.breathing_rate,
    hrv: row.hrv,
    dominantMotionHz: row.dominant_motion_hz,
    motionEnergy: row.motion_energy,
    phaseStability: row.phase_stability,
    qualityScore: row.quality_score,
    qualityGrade: row.quality_grade,
    interferenceScore: row.interference_score,
    multiPersonLikely: row.multi_person_likely === 1,
    inferenceSource: row.inference_source,
    flags: parseJsonField<string[]>(row.flags_json, []),
  };
}

export function recordTrendEntry(result: InferenceResult): void {
  const db = getServerDb();
  const recordId = crypto.randomUUID();
  const flags = result.diagnostics?.warnings ?? [];

  db.prepare(
    `INSERT INTO trend_records (
      record_id, timestamp_ms, input_source, body_fat_percent, heart_rate, breathing_rate, hrv,
      dominant_motion_hz, motion_energy, phase_stability, quality_score, quality_grade,
      interference_score, multi_person_likely, inference_source, flags_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    recordId,
    result.frame.timestamp,
    result.inputSource,
    result.analysis.bodyFatPercent,
    result.frame.vitals.heartRate,
    result.frame.vitals.breathingRate,
    result.frame.vitals.hrv,
    result.frame.temporal.dominantMotionHz,
    result.frame.temporal.motionEnergy,
    result.frame.temporal.phaseStability,
    result.diagnostics.qualityScore,
    result.diagnostics.qualityGrade,
    result.diagnostics.interferenceScore,
    result.diagnostics.multiPersonLikely ? 1 : 0,
    result.analysis.source,
    stringifyJson(flags)
  );
}

export function listRecentTrendRecords(limit = 120): TrendRecord[] {
  const db = getServerDb();
  const rows = db
    .prepare(
      `SELECT
        record_id, timestamp_ms, input_source, body_fat_percent, heart_rate, breathing_rate, hrv,
        dominant_motion_hz, motion_energy, phase_stability, quality_score, quality_grade,
        interference_score, multi_person_likely, inference_source, flags_json
       FROM trend_records
       ORDER BY timestamp_ms DESC
       LIMIT ?`
    )
    .all(Math.max(1, Math.round(limit))) as Array<{
    record_id: string;
    timestamp_ms: number;
    input_source: string;
    body_fat_percent: number;
    heart_rate: number;
    breathing_rate: number;
    hrv: number;
    dominant_motion_hz: number;
    motion_energy: number;
    phase_stability: number;
    quality_score: number;
    quality_grade: string;
    interference_score: number;
    multi_person_likely: number;
    inference_source: string;
    flags_json: string | null;
  }>;

  return rows.map(toTrendRecord);
}

export function getTrendSummary(windowDays = 30): TrendSummary {
  const safeWindowDays = clamp(Math.round(windowDays), 1, 365);
  const cutoffMs = Date.now() - safeWindowDays * 24 * 60 * 60 * 1000;
  const db = getServerDb();

  const rows = db
    .prepare(
      `SELECT
        record_id, timestamp_ms, input_source, body_fat_percent, heart_rate, breathing_rate, hrv,
        dominant_motion_hz, motion_energy, phase_stability, quality_score, quality_grade,
        interference_score, multi_person_likely, inference_source, flags_json
       FROM trend_records
       WHERE timestamp_ms >= ?
       ORDER BY timestamp_ms ASC`
    )
    .all(cutoffMs) as Array<{
    record_id: string;
    timestamp_ms: number;
    input_source: string;
    body_fat_percent: number;
    heart_rate: number;
    breathing_rate: number;
    hrv: number;
    dominant_motion_hz: number;
    motion_energy: number;
    phase_stability: number;
    quality_score: number;
    quality_grade: string;
    interference_score: number;
    multi_person_likely: number;
    inference_source: string;
    flags_json: string | null;
  }>;

  const records = rows.map(toTrendRecord);
  const first = records[0] ?? null;
  const latest = records[records.length - 1] ?? null;

  const deltas = {
    bodyFatPercent:
      first && latest ? round(latest.bodyFatPercent - first.bodyFatPercent, 3) : null,
    heartRate: first && latest ? round(latest.heartRate - first.heartRate, 3) : null,
    breathingRate:
      first && latest ? round(latest.breathingRate - first.breathingRate, 3) : null,
    hrv: first && latest ? round(latest.hrv - first.hrv, 3) : null,
  };

  const byInputSource: Record<string, number> = {};
  for (const record of records) {
    byInputSource[record.inputSource] = (byInputSource[record.inputSource] ?? 0) + 1;
  }

  const anomalies: string[] = [];
  if (records.length >= 3) {
    const last3 = records.slice(-3);
    const lowQualityCount = last3.filter((record) => record.qualityScore < 0.45).length;
    if (lowQualityCount >= 2) anomalies.push("Repeated low-quality scans in recent sessions.");

    const multiPersonCount = last3.filter((record) => record.multiPersonLikely).length;
    if (multiPersonCount >= 2) anomalies.push("Repeated multi-person/interference indications detected.");
  }
  if (deltas.bodyFatPercent !== null && Math.abs(deltas.bodyFatPercent) >= 2.5) {
    anomalies.push("Large body-fat estimate shift in selected trend window.");
  }
  if (deltas.hrv !== null && deltas.hrv <= -15) {
    anomalies.push("HRV dropped significantly across recent scans.");
  }

  let riskLevel: "low" | "moderate" | "high" = "low";
  if (anomalies.length >= 3) riskLevel = "high";
  else if (anomalies.length >= 1) riskLevel = "moderate";

  return {
    windowDays: safeWindowDays,
    totalScans: records.length,
    byInputSource,
    firstTimestampMs: first?.timestampMs ?? null,
    lastTimestampMs: latest?.timestampMs ?? null,
    deltas,
    latest,
    anomalies,
    riskLevel,
  };
}

