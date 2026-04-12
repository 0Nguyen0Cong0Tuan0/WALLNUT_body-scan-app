import { NextRequest, NextResponse } from "next/server";
import { startUploadJob } from "@/lib/uploadJobs";
import { InvalidCsiFileError } from "@/lib/scanErrors";
import { buildScanErrorResponse } from "@/app/api/_shared/scanResponses";

export const runtime = "nodejs";

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
    return buildScanErrorResponse(error);
  }
}

