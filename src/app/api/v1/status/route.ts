import { NextRequest, NextResponse } from "next/server";
import { getMeshStatus, resolveLivePort } from "@/lib/liveCsi";
import { toScanServiceError } from "@/lib/scanErrors";

export const runtime = "nodejs";

function toOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}

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
    return buildErrorResponse(error);
  }
}

