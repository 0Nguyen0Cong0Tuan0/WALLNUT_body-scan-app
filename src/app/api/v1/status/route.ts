import { NextRequest, NextResponse } from "next/server";
import { getMeshStatus, resolveLivePort } from "@/lib/liveCsi";
import { buildScanErrorResponse, toOptionalNumber } from "@/app/api/_shared/scanResponses";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const requestedPort = toOptionalNumber(req.nextUrl.searchParams.get("port"));
    const requestedTimeoutMs = toOptionalNumber(req.nextUrl.searchParams.get("timeoutMs"));
    const port = resolveLivePort(requestedPort);

    const status = await getMeshStatus({
      port,
      timeoutMs: requestedTimeoutMs,
    });

    return NextResponse.json({
      success: true,
      status,
    });
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

