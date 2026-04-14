import { NextRequest, NextResponse } from "next/server";
import { runVisionEngine } from "@/lib/visionEngine";

export async function POST(req: NextRequest) {
  try {
    const data = await req.formData();
    const imageFile = data.get("imageFile") as File | null;
    const heightCm = Number(data.get("heightCm") || 170);
    const weightKg = Number(data.get("weightKg") || 70);

    if (!imageFile) {
      return NextResponse.json({ success: false, error: "Missing image file" }, { status: 400 });
    }

    // Convert file to base64
    const buffer = await imageFile.arrayBuffer();
    const base64Data = Buffer.from(buffer).toString("base64");
    const mimeType = imageFile.type || "image/jpeg";
    const dataURI = `data:${mimeType};base64,${base64Data}`;

    // Call Vision Engine
    const analysis = await runVisionEngine(dataURI, heightCm, weightKg);

    // Mock the frame and diagnostics to satisfy the frontend ScanResponse format
    // Because Image Mode doesn't have CSI subcarriers, heart rate, or temporal phase stability
    const mockFrame = {
      timestamp: Date.now(),
      nodeId: "Camera/Image",
      channel: 0,
      subcarriers: 0,
      rssi: 0,
      keypoints: [],
      vitals: {
        heartRate: 0,
        breathingRate: 0,
        hrv: 0,
      },
      bodyMetrics: {
        estimatedHeightCm: heightCm,
        shoulderWidthCm: heightCm * 0.25, // default approximations
        hipWidthCm: heightCm * 0.20,
        torsoLengthCm: heightCm * 0.35,
        leftArmLengthCm: heightCm * 0.40,
        rightArmLengthCm: heightCm * 0.40,
        leftLegLengthCm: heightCm * 0.50,
        bmi_proxy: 1,
      },
    };

    const mockDiagnostics = {
      qualityScore: 0.95,
      qualityGrade: "A",
      qualityGatePassed: true,
      qualityComponents: {
        frameCoverage: 1,
        sampleRate: 1,
        rssiStrength: 1,
        temporalStability: 1,
        motionConsistency: 1,
        nodeCoverage: 1,
      },
      interferenceScore: 0,
      multiPersonLikely: false,
      warnings: ["Image mode does not capture HR, HRV, or Breath Rate."],
      calibration: {
        baselineApplied: false,
        driftCompensationStrength: 0,
      },
    };

    return NextResponse.json({
      success: true,
      frame: mockFrame,
      analysis,
      inputSource: "image",
      diagnostics: mockDiagnostics
    });

  } catch (error) {
    console.error("Image Scan API Error:", error);
    return NextResponse.json({ 
      success: false, 
      error: error instanceof Error ? error.message : "Internal Server Error" 
    }, { status: 500 });
  }
}
