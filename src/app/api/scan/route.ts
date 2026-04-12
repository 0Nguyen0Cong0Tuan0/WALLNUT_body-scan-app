import { NextRequest, NextResponse } from "next/server";
import { parseCsiFile } from "@/lib/csiProcessor";
import { assertLiveTraffic, resolveLiveMaxPackets, resolveLivePort, resolveLiveProbeTimeoutMs } from "@/lib/liveCsi";
import { UnsupportedScanModeError, InvalidCsiFileError } from "@/lib/scanErrors";
import { generateSimulatedParsedCsi } from "@/lib/simulatedCsi";
import { buildScanErrorResponse } from "@/app/api/_shared/scanResponses";
import { processScanInference } from "@/lib/scanPipeline";

export const runtime = "nodejs";

interface ScanRequestBody {
  mode?: "live" | "simulate" | "upload";
  livePort?: number;
  analysisModel?: string | null;
  calibrationProfileId?: string | null;
  baselineId?: string | null;
  qualityGateMin?: number;
  driftCompensationStrength?: number;
}

async function parseRequestBody(req: NextRequest): Promise<ScanRequestBody> {
  const contentType = req.headers.get("content-type") ?? "";

  if (contentType.includes("multipart/form-data")) {
    throw new InvalidCsiFileError("File uploads must use /api/scan/upload for progress-aware processing.");
  }

  if (!contentType || contentType.includes("application/json")) {
    try {
      return (await req.json()) as ScanRequestBody;
    } catch {
      return {};
    }
  }

  return {};
}

export async function POST(req: NextRequest) {
  try {
    const body = await parseRequestBody(req);
    const mode = body.mode ?? "simulate";

    if (mode === "live") {
      const port = resolveLivePort(body.livePort);
      const capture = await assertLiveTraffic({
        port,
        minPackets: 4,
        timeoutMs: resolveLiveProbeTimeoutMs(),
        maxPackets: resolveLiveMaxPackets(),
      });

      const parsedCsi = parseCsiFile(capture.jsonl);
      const result = await processScanInference(parsedCsi, `live:udp:${port}`, {
        analysisModel: body.analysisModel,
        calibrationProfileId: body.calibrationProfileId,
        baselineId: body.baselineId,
        qualityGateMin: body.qualityGateMin,
        driftCompensationStrength: body.driftCompensationStrength,
      });

      return NextResponse.json({
        success: true,
        ...result,
        hardware: {
          port,
          timeoutMs: capture.timeoutMs,
          packetsReceived: capture.packetsReceived,
          activeNodes: capture.nodes.length,
          nodes: capture.nodes,
          lastPacketAtMs: capture.lastPacketAtMs,
        },
      });
    }

    if (mode === "simulate") {
      const parsed = generateSimulatedParsedCsi();
      const result = await processScanInference(parsed, "simulated", {
        analysisModel: body.analysisModel,
        calibrationProfileId: body.calibrationProfileId,
        baselineId: body.baselineId,
        qualityGateMin: body.qualityGateMin,
        driftCompensationStrength: body.driftCompensationStrength,
      });
      return NextResponse.json({
        success: true,
        ...result,
      });
    }

    if (mode === "upload") {
      throw new InvalidCsiFileError("Upload mode must use /api/scan/upload.");
    }

    throw new UnsupportedScanModeError(String(mode));
  } catch (error) {
    return buildScanErrorResponse(error);
  }
}

