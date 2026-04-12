import { NextRequest, NextResponse } from "next/server";
import { parseCsiFile } from "@/lib/csiProcessor";
import { runInferenceEngine } from "@/lib/inferenceEngine";
import { assertLiveTraffic, resolveLiveMaxPackets, resolveLivePort, resolveLiveProbeTimeoutMs } from "@/lib/liveCsi";
import { toScanServiceError, UnsupportedScanModeError, InvalidCsiFileError } from "@/lib/scanErrors";
import { generateSimulatedParsedCsi } from "@/lib/simulatedCsi";
import type { SimulatedActivity } from "@/lib/ruviewSimulator";

export const runtime = "nodejs";

interface ScanRequestBody {
  mode?: "live" | "simulate" | "upload";
  livePort?: number;
  simulatedActivity?: SimulatedActivity;
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
      const result = await runInferenceEngine(parsedCsi, `live:udp:${port}`);

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
      const { parsed, activity } = generateSimulatedParsedCsi(body.simulatedActivity);
      const result = await runInferenceEngine(parsed, `simulated:${activity}`);
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
    return buildErrorResponse(error);
  }
}

