import type { ParsedCSI } from "@/lib/csiProcessor";
import { runInferenceEngine, type InferenceResult } from "@/lib/inferenceEngine";
import {
  applyRoomBaselineCompensation,
  getCalibrationProfile,
  getRoomBaseline,
  resolveCalibrationApplication,
} from "@/lib/calibrationStore";
import { recordTrendEntry } from "@/lib/trendStore";
import { CalibrationNotFoundError } from "@/lib/scanErrors";

export interface ScanPipelineOptions {
  calibrationProfileId?: string | null;
  baselineId?: string | null;
  driftCompensationStrength?: number;
  qualityGateMin?: number;
  analysisModel?: string | null;
}

function normalizedId(value?: string | null): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export async function processScanInference(
  parsedCsi: ParsedCSI,
  inputSource: string,
  options?: ScanPipelineOptions
): Promise<InferenceResult> {
  const calibrationProfileId = normalizedId(options?.calibrationProfileId);
  const requestedBaselineId = normalizedId(options?.baselineId);

  if (calibrationProfileId && !getCalibrationProfile(calibrationProfileId)) {
    throw new CalibrationNotFoundError("Requested calibration profile does not exist.", {
      profileId: calibrationProfileId,
    });
  }
  if (requestedBaselineId && !getRoomBaseline(requestedBaselineId)) {
    throw new CalibrationNotFoundError("Requested room baseline does not exist.", {
      baselineId: requestedBaselineId,
    });
  }

  const calibration = resolveCalibrationApplication(calibrationProfileId);
  const baselineApplied = applyRoomBaselineCompensation(parsedCsi, {
    baselineId: requestedBaselineId,
    driftCompensationStrength: options?.driftCompensationStrength,
  });

  const result = await runInferenceEngine(baselineApplied.parsed, inputSource, {
    qualityGateMin: options?.qualityGateMin,
    analysisModel: options?.analysisModel,
    calibration: {
      ...calibration.corrections,
      profileId: calibration.profileId,
    },
    baselineApplied: baselineApplied.baselineApplied,
    driftCompensationStrength: baselineApplied.driftCompensationStrength,
  });

  recordTrendEntry(result);
  return result;
}

