import { NextResponse } from "next/server";
import { buildScanErrorResponse } from "@/app/api/_shared/scanResponses";
import { listAnalysisModelOptions } from "@/lib/analysisModels";

export const runtime = "nodejs";

export async function GET() {
  try {
    const models = listAnalysisModelOptions();
    return NextResponse.json({
      success: true,
      models,
    });
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

