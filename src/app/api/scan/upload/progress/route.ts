import { NextRequest, NextResponse } from "next/server";
import { getUploadJob } from "@/lib/uploadJobs";
import { UploadJobNotFoundError } from "@/lib/scanErrors";
import { buildScanErrorResponse } from "@/app/api/_shared/scanResponses";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const jobId = req.nextUrl.searchParams.get("jobId");
    if (!jobId) {
      throw new UploadJobNotFoundError("missing");
    }

    const job = getUploadJob(jobId);
    if (!job) {
      throw new UploadJobNotFoundError(jobId);
    }

    return NextResponse.json({
      success: true,
      ...job,
    });
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

