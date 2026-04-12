import { NextRequest, NextResponse } from "next/server";
import { buildScanErrorResponse, toOptionalNumber } from "@/app/api/_shared/scanResponses";
import { getTrendSummary, listRecentTrendRecords } from "@/lib/trendStore";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  try {
    const windowDays = toOptionalNumber(req.nextUrl.searchParams.get("windowDays"));
    const limit = toOptionalNumber(req.nextUrl.searchParams.get("limit"));
    const summary = getTrendSummary(windowDays);
    const records = listRecentTrendRecords(limit);
    return NextResponse.json({
      success: true,
      summary,
      records,
    });
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

