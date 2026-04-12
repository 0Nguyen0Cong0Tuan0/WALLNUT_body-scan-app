import { NextResponse } from "next/server";
import { toScanServiceError } from "@/lib/scanErrors";

export function buildScanErrorResponse(error: unknown) {
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

export function toOptionalNumber(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return undefined;
  return parsed;
}
