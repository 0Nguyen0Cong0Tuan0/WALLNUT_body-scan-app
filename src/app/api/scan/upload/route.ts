import { NextRequest, NextResponse } from "next/server";
import { startUploadJob } from "@/lib/uploadJobs";
import { InvalidCsiFileError } from "@/lib/scanErrors";
import { buildScanErrorResponse } from "@/app/api/_shared/scanResponses";

export const runtime = "nodejs";

function parseOptionalNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

function parseOptionalString(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fileEntry = formData.get("csiFile");

    if (!(fileEntry instanceof File)) {
      throw new InvalidCsiFileError("No CSI file provided for upload processing.");
    }

    const job = startUploadJob(fileEntry, {
      analysisModel: parseOptionalString(formData.get("analysisModel")),
      calibrationProfileId: parseOptionalString(formData.get("calibrationProfileId")),
      baselineId: parseOptionalString(formData.get("baselineId")),
      qualityGateMin: parseOptionalNumber(formData.get("qualityGateMin")),
      driftCompensationStrength: parseOptionalNumber(formData.get("driftCompensationStrength")),
    });
    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      stage: job.stage,
      progress: job.progress,
    });
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

