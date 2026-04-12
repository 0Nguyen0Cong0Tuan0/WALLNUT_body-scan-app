import { NextRequest, NextResponse } from "next/server";
import { getUploadJob } from "@/lib/uploadJobs";
import { UploadJobNotFoundError, toScanServiceError } from "@/lib/scanErrors";

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
    return buildErrorResponse(error);
  }
}

