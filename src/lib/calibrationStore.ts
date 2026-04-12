import { getServerDb, getSetting, parseJsonField, setSetting, stringifyJson } from "@/lib/serverDb";
import type { ParsedCSI } from "@/lib/csiProcessor";

const ACTIVE_PROFILE_KEY = "activeCalibrationProfileId";
const ACTIVE_BASELINE_KEY = "activeRoomBaselineId";

export interface CalibrationCorrections {
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

export interface CalibrationProfile {
  profileId: string;
  label: string;
  corrections: CalibrationCorrections;
  notes?: string;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface RoomBaseline {
  baselineId: string;
  source: string;
  numSubcarriers: number;
  sampleCount: number;
  meanAmplitude: number;
  subcarrierProfile: number[];
  capturedAtMs: number;
  updatedAtMs: number;
}

export interface CalibrationApplication {
  profileId?: string;
  corrections: CalibrationCorrections;
  baselineApplied: boolean;
  baselineId?: string;
  driftCompensationStrength: number;
}

const DEFAULT_CORRECTIONS: CalibrationCorrections = {
  heartRateBiasBpm: 0,
  breathingRateBiasBpm: 0,
  hrvBiasMs: 0,
  shoulderScale: 1,
  hipScale: 1,
  torsoScale: 1,
  leftArmScale: 1,
  rightArmScale: 1,
  leftLegScale: 1,
  bodyFatBiasPercent: 0,
  waistBiasCm: 0,
};

function clamp(value: number, minValue: number, maxValue: number): number {
  return Math.min(maxValue, Math.max(minValue, value));
}

function round(value: number, digits = 4): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function normalizeCorrections(value?: Partial<CalibrationCorrections>): CalibrationCorrections {
  const inValue = value ?? {};
  return {
    heartRateBiasBpm: round(clamp(Number(inValue.heartRateBiasBpm ?? 0), -30, 30), 2),
    breathingRateBiasBpm: round(clamp(Number(inValue.breathingRateBiasBpm ?? 0), -12, 12), 2),
    hrvBiasMs: round(clamp(Number(inValue.hrvBiasMs ?? 0), -60, 60), 2),
    shoulderScale: round(clamp(Number(inValue.shoulderScale ?? 1), 0.75, 1.3), 4),
    hipScale: round(clamp(Number(inValue.hipScale ?? 1), 0.75, 1.3), 4),
    torsoScale: round(clamp(Number(inValue.torsoScale ?? 1), 0.75, 1.3), 4),
    leftArmScale: round(clamp(Number(inValue.leftArmScale ?? 1), 0.75, 1.3), 4),
    rightArmScale: round(clamp(Number(inValue.rightArmScale ?? 1), 0.75, 1.3), 4),
    leftLegScale: round(clamp(Number(inValue.leftLegScale ?? 1), 0.75, 1.3), 4),
    bodyFatBiasPercent: round(clamp(Number(inValue.bodyFatBiasPercent ?? 0), -12, 12), 3),
    waistBiasCm: round(clamp(Number(inValue.waistBiasCm ?? 0), -20, 20), 2),
  };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function mapCalibrationProfileRow(row: {
  profile_id: string;
  label: string;
  corrections_json: string;
  notes: string | null;
  created_at_ms: number;
  updated_at_ms: number;
}): CalibrationProfile {
  return {
    profileId: row.profile_id,
    label: row.label,
    corrections: normalizeCorrections(parseJsonField<Partial<CalibrationCorrections>>(row.corrections_json, {})),
    notes: row.notes ?? undefined,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

function mapRoomBaselineRow(row: {
  baseline_id: string;
  source: string;
  num_subcarriers: number;
  sample_count: number;
  mean_amplitude: number;
  subcarrier_profile_json: string;
  captured_at_ms: number;
  updated_at_ms: number;
}): RoomBaseline {
  return {
    baselineId: row.baseline_id,
    source: row.source,
    numSubcarriers: row.num_subcarriers,
    sampleCount: row.sample_count,
    meanAmplitude: row.mean_amplitude,
    subcarrierProfile: parseJsonField<number[]>(row.subcarrier_profile_json, []),
    capturedAtMs: row.captured_at_ms,
    updatedAtMs: row.updated_at_ms,
  };
}

export function listCalibrationProfiles(): CalibrationProfile[] {
  const db = getServerDb();
  const rows = db
    .prepare(
      `SELECT profile_id, label, corrections_json, notes, created_at_ms, updated_at_ms
       FROM calibration_profiles
       ORDER BY updated_at_ms DESC`
    )
    .all() as Array<{
    profile_id: string;
    label: string;
    corrections_json: string;
    notes: string | null;
    created_at_ms: number;
    updated_at_ms: number;
  }>;

  return rows.map(mapCalibrationProfileRow);
}

export function getCalibrationProfile(profileId: string): CalibrationProfile | null {
  const db = getServerDb();
  const row = db
    .prepare(
      `SELECT profile_id, label, corrections_json, notes, created_at_ms, updated_at_ms
       FROM calibration_profiles
       WHERE profile_id = ?`
    )
    .get(profileId) as
    | {
        profile_id: string;
        label: string;
        corrections_json: string;
        notes: string | null;
        created_at_ms: number;
        updated_at_ms: number;
      }
    | undefined;
  if (!row) return null;
  return mapCalibrationProfileRow(row);
}

export function getActiveCalibrationProfile(): CalibrationProfile | null {
  const activeId = getSetting<string | null>(ACTIVE_PROFILE_KEY, null);
  if (!activeId) return null;
  return getCalibrationProfile(activeId);
}

export function upsertCalibrationProfile(input: {
  profileId?: string;
  label: string;
  corrections?: Partial<CalibrationCorrections>;
  notes?: string;
  activate?: boolean;
}): CalibrationProfile {
  const db = getServerDb();
  const now = Date.now();
  const profileId = input.profileId?.trim() || crypto.randomUUID();
  const corrections = normalizeCorrections(input.corrections);
  const label = input.label.trim().length > 0 ? input.label.trim() : "Calibration Profile";
  const notes = input.notes?.trim();

  db.prepare(
    `INSERT INTO calibration_profiles (profile_id, label, corrections_json, notes, created_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(profile_id) DO UPDATE SET
       label = excluded.label,
       corrections_json = excluded.corrections_json,
       notes = excluded.notes,
       updated_at_ms = excluded.updated_at_ms`
  ).run(profileId, label, stringifyJson(corrections), notes ?? null, now, now);

  if (input.activate) setSetting(ACTIVE_PROFILE_KEY, profileId);

  const profile = listCalibrationProfiles().find((item) => item.profileId === profileId);
  if (!profile) {
    throw new Error("Calibration profile write failed.");
  }
  return profile;
}

export function setActiveCalibrationProfile(profileId: string | null): void {
  if (!profileId) {
    setSetting(ACTIVE_PROFILE_KEY, null);
    return;
  }
  if (!getCalibrationProfile(profileId)) {
    throw new Error(`Calibration profile not found: ${profileId}`);
  }
  setSetting(ACTIVE_PROFILE_KEY, profileId);
}

export function listRoomBaselines(): RoomBaseline[] {
  const db = getServerDb();
  const rows = db
    .prepare(
      `SELECT baseline_id, source, num_subcarriers, sample_count, mean_amplitude, subcarrier_profile_json, captured_at_ms, updated_at_ms
       FROM room_baselines
       ORDER BY updated_at_ms DESC`
    )
    .all() as Array<{
    baseline_id: string;
    source: string;
    num_subcarriers: number;
    sample_count: number;
    mean_amplitude: number;
    subcarrier_profile_json: string;
    captured_at_ms: number;
    updated_at_ms: number;
  }>;

  return rows.map(mapRoomBaselineRow);
}

export function getRoomBaseline(baselineId: string): RoomBaseline | null {
  const db = getServerDb();
  const row = db
    .prepare(
      `SELECT baseline_id, source, num_subcarriers, sample_count, mean_amplitude, subcarrier_profile_json, captured_at_ms, updated_at_ms
       FROM room_baselines
       WHERE baseline_id = ?`
    )
    .get(baselineId) as
    | {
        baseline_id: string;
        source: string;
        num_subcarriers: number;
        sample_count: number;
        mean_amplitude: number;
        subcarrier_profile_json: string;
        captured_at_ms: number;
        updated_at_ms: number;
      }
    | undefined;
  if (!row) return null;
  return mapRoomBaselineRow(row);
}

export function getActiveRoomBaseline(): RoomBaseline | null {
  const activeId = getSetting<string | null>(ACTIVE_BASELINE_KEY, null);
  if (!activeId) return null;
  return getRoomBaseline(activeId);
}

export function setActiveRoomBaseline(baselineId: string | null): void {
  if (!baselineId) {
    setSetting(ACTIVE_BASELINE_KEY, null);
    return;
  }
  if (!getRoomBaseline(baselineId)) {
    throw new Error(`Room baseline not found: ${baselineId}`);
  }
  setSetting(ACTIVE_BASELINE_KEY, baselineId);
}

export function captureRoomBaseline(
  parsed: ParsedCSI,
  options?: { baselineId?: string; source?: string; activate?: boolean }
): RoomBaseline {
  const db = getServerDb();
  const now = Date.now();
  const baselineId = options?.baselineId?.trim() || `baseline-${now}`;
  const source = options?.source?.trim() || "capture";

  const meanAmplitude = mean(parsed.amplitudeTimeseries);
  const payload: RoomBaseline = {
    baselineId,
    source,
    numSubcarriers: parsed.numSubcarriers,
    sampleCount: parsed.numFrames,
    meanAmplitude: round(meanAmplitude, 6),
    subcarrierProfile: parsed.subcarrierProfile.map((value) => round(value, 6)),
    capturedAtMs: now,
    updatedAtMs: now,
  };

  db.prepare(
    `INSERT INTO room_baselines (baseline_id, source, num_subcarriers, sample_count, mean_amplitude, subcarrier_profile_json, captured_at_ms, updated_at_ms)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(baseline_id) DO UPDATE SET
       source = excluded.source,
       num_subcarriers = excluded.num_subcarriers,
       sample_count = excluded.sample_count,
       mean_amplitude = excluded.mean_amplitude,
       subcarrier_profile_json = excluded.subcarrier_profile_json,
       captured_at_ms = excluded.captured_at_ms,
       updated_at_ms = excluded.updated_at_ms`
  ).run(
    payload.baselineId,
    payload.source,
    payload.numSubcarriers,
    payload.sampleCount,
    payload.meanAmplitude,
    stringifyJson(payload.subcarrierProfile),
    payload.capturedAtMs,
    payload.updatedAtMs
  );

  if (options?.activate ?? true) {
    setActiveRoomBaseline(payload.baselineId);
  }
  return payload;
}

export function applyRoomBaselineCompensation(
  parsed: ParsedCSI,
  options?: {
    baselineId?: string;
    driftCompensationStrength?: number;
  }
): {
  parsed: ParsedCSI;
  baselineApplied: boolean;
  baselineId?: string;
  driftCompensationStrength: number;
} {
  const baseline = options?.baselineId ? getRoomBaseline(options.baselineId) : getActiveRoomBaseline();
  if (!baseline) {
    return {
      parsed,
      baselineApplied: false,
      baselineId: options?.baselineId,
      driftCompensationStrength: 0,
    };
  }
  if (baseline.numSubcarriers !== parsed.numSubcarriers || baseline.subcarrierProfile.length !== parsed.numSubcarriers) {
    return {
      parsed,
      baselineApplied: false,
      baselineId: baseline.baselineId,
      driftCompensationStrength: 0,
    };
  }

  const driftStrength = clamp(options?.driftCompensationStrength ?? 0.35, 0.05, 0.9);
  const baselineOffsets = baseline.subcarrierProfile.map((value) => value - baseline.meanAmplitude);
  const adjustedMatrix = parsed.amplitudeMatrix.map((row) =>
    row.map((value, index) => round(Math.max(0.01, value - baselineOffsets[index] * driftStrength), 6))
  );
  const adjustedTimeseries = adjustedMatrix.map((row) => round(mean(row), 6));
  const adjustedProfile = baselineOffsets.map((_, index) =>
    round(mean(adjustedMatrix.map((row) => row[index])), 6)
  );

  const adjustedParsed: ParsedCSI = {
    ...parsed,
    amplitudeMatrix: adjustedMatrix,
    amplitudeTimeseries: adjustedTimeseries,
    subcarrierProfile: adjustedProfile,
    scenarioHints: [...parsed.scenarioHints, `baseline:${baseline.baselineId}`],
  };

  return {
    parsed: adjustedParsed,
    baselineApplied: true,
    baselineId: baseline.baselineId,
    driftCompensationStrength: driftStrength,
  };
}

export function resolveCalibrationApplication(profileId?: string): CalibrationApplication {
  const profile = profileId ? getCalibrationProfile(profileId) : getActiveCalibrationProfile();
  return {
    profileId: profile?.profileId,
    corrections: profile?.corrections ?? DEFAULT_CORRECTIONS,
    baselineApplied: false,
    driftCompensationStrength: 0,
  };
}

export function defaultCalibrationCorrections(): CalibrationCorrections {
  return { ...DEFAULT_CORRECTIONS };
}

