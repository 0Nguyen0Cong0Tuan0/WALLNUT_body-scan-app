import { NextRequest, NextResponse } from "next/server";
import {
  captureRoomBaseline,
  defaultCalibrationCorrections,
  getActiveCalibrationProfile,
  getActiveRoomBaseline,
  listCalibrationProfiles,
  listRoomBaselines,
  setActiveCalibrationProfile,
  setActiveRoomBaseline,
  upsertCalibrationProfile,
} from "@/lib/calibrationStore";
import type { CalibrationCorrections } from "@/lib/calibrationStore";
import { parseCsiFile } from "@/lib/csiProcessor";
import { InvalidCsiFileError } from "@/lib/scanErrors";
import { buildScanErrorResponse } from "@/app/api/_shared/scanResponses";

export const runtime = "nodejs";

interface CalibrationPostBody {
  action?: "upsert_profile" | "set_active_profile" | "set_active_baseline" | "capture_baseline";
  profileId?: string | null;
  baselineId?: string | null;
  label?: string;
  notes?: string;
  corrections?: Record<string, unknown>;
  activate?: boolean;
  source?: string;
  csiPayload?: string;
}

function buildCalibrationSnapshot() {
  return {
    defaults: defaultCalibrationCorrections(),
    activeProfile: getActiveCalibrationProfile(),
    activeBaseline: getActiveRoomBaseline(),
    profiles: listCalibrationProfiles(),
    baselines: listRoomBaselines(),
  };
}

export async function GET() {
  try {
    return NextResponse.json({
      success: true,
      ...buildCalibrationSnapshot(),
    });
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CalibrationPostBody;
    const action = body.action;

    if (action === "upsert_profile") {
      const label = body.label?.trim();
      if (!label) throw new InvalidCsiFileError("Calibration profile label is required.");
      const profile = upsertCalibrationProfile({
        profileId: body.profileId ?? undefined,
        label,
        corrections: (body.corrections ?? undefined) as Partial<CalibrationCorrections> | undefined,
        notes: body.notes,
        activate: body.activate ?? false,
      });
      return NextResponse.json({
        success: true,
        profile,
        ...buildCalibrationSnapshot(),
      });
    }

    if (action === "set_active_profile") {
      setActiveCalibrationProfile(body.profileId ?? null);
      return NextResponse.json({
        success: true,
        ...buildCalibrationSnapshot(),
      });
    }

    if (action === "set_active_baseline") {
      setActiveRoomBaseline(body.baselineId ?? null);
      return NextResponse.json({
        success: true,
        ...buildCalibrationSnapshot(),
      });
    }

    if (action === "capture_baseline") {
      const csiPayload = body.csiPayload?.trim();
      if (!csiPayload) {
        throw new InvalidCsiFileError("csiPayload is required to capture a baseline.");
      }
      const parsed = parseCsiFile(csiPayload);
      const baseline = captureRoomBaseline(parsed, {
        baselineId: body.baselineId ?? undefined,
        source: body.source ?? "manual_capture",
        activate: body.activate ?? true,
      });
      return NextResponse.json({
        success: true,
        baseline,
        ...buildCalibrationSnapshot(),
      });
    }

    throw new InvalidCsiFileError("Unsupported calibration action.");
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

