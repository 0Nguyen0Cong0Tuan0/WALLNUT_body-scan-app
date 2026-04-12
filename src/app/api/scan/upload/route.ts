import { NextRequest, NextResponse } from "next/server";
import { startUploadJob } from "@/lib/uploadJobs";
import { InvalidCsiFileError, toScanServiceError } from "@/lib/scanErrors";

export const runtime = "nodejs";

function buildErrorResponse(error: unknown) {
  const scanError = toScanServiceError(error);
  return NextResponse.json(
    {
      success: false,
      error: scanError.message,
      code: scanError.code,
      details: scanError.details,
    },
    { status: scanError.status }
  );
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const fileEntry = formData.get("csiFile");

    if (!(fileEntry instanceof File)) {
      throw new InvalidCsiFileError("No CSI file provided for upload processing.");
    }

    const job = startUploadJob(fileEntry);
    return NextResponse.json({
      success: true,
      jobId: job.jobId,
      stage: job.stage,
      progress: job.progress,
    });
  } catch (error) {
    return buildErrorResponse(error);
  }
}

