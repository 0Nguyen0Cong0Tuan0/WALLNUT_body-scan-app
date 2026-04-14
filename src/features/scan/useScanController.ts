"use client";

import { useCallback, useState } from "react";
import { addScanRecord } from "@/lib/scanHistory";
import type {
  Analysis,
  AnalysisModelId,
  CsiMeta,
  ScanDiagnostics,
  ScanFrame,
  ScanRequest,
  ScanState,
} from "./types";

interface UploadStartResponse {
  success: boolean;
  jobId?: string;
  error?: string;
}

interface UploadProgressResponse {
  success: boolean;
  progress?: number;
  stage?: string;
  result?: {
    frame: ScanFrame;
    analysis: Analysis;
    inputSource: string;
    diagnostics: ScanDiagnostics;
  };
  error?: {
    message?: string;
  };
}

interface ScanResponse {
  success: boolean;
  frame?: ScanFrame;
  analysis?: Analysis;
  inputSource?: string;
  diagnostics?: ScanDiagnostics;
  error?: string;
}

function resolveHistoryInputSource(inputSource: string, mode: ScanRequest["mode"]): ScanRequest["mode"] {
  if (inputSource.includes("live")) return "live";
  if (inputSource.includes("simulate")) return "simulate";
  if (inputSource.includes("upload") || inputSource.includes("file")) return "upload";
  return mode;
}

function buildPersistenceWarning(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return `Scan completed, but local history could not be saved (${message}).`;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

export function useScanController() {
  const [scanState, setScanState] = useState<ScanState>("idle");
  const [frame, setFrame] = useState<ScanFrame | null>(null);
  const [analysis, setAnalysis] = useState<Analysis | null>(null);
  const [csiMeta, setCsiMeta] = useState<CsiMeta | undefined>(undefined);
  const [diagnostics, setDiagnostics] = useState<ScanDiagnostics | null>(null);
  const [inputSource, setInputSource] = useState("simulated");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warningMsg, setWarningMsg] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [activeMode, setActiveMode] = useState<"upload" | "live" | "simulate" | "image" | null>(null);
  const [activeAnalysisModel, setActiveAnalysisModel] = useState<AnalysisModelId>("none");

  // Function to generate Clinical Summary via Qwen AI
  const generateClinicalSummary = useCallback(async (frame: ScanFrame, baseAnalysis: Analysis): Promise<Analysis> => {
    try {
      const scanMetrics = {
        heartRateBpm: frame.vitals.heartRate,
        breathingRateBpm: frame.vitals.breathingRate,
        hrv: frame.vitals.hrv,
        bodyFatPercent: baseAnalysis.bodyFatPercent,
        bodyFatClassification: baseAnalysis.bodyFatClassification,
        estimatedHeightCm: frame.bodyMetrics.estimatedHeightCm,
        shoulderWidthCm: frame.bodyMetrics.shoulderWidthCm,
        hipWidthCm: frame.bodyMetrics.hipWidthCm,
      };

      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: "Generate a complete clinical summary report based on my scan data.",
          scanMetrics,
        }),
      });

      if (!res.ok) {
        console.error("[Clinical Summary] Failed to generate:", res.status);
        return baseAnalysis;
      }

      const data = await res.json() as { answer: string };
      
      // Return analysis with AI-generated clinical summary
      return {
        ...baseAnalysis,
        clinicalSummary: data.answer,
        source: "qwen",
      };
    } catch (err) {
      console.error("[Clinical Summary] Error:", err);
      return baseAnalysis;
    }
  }, []);

  const applyResult = useCallback(
    async (
      data: { frame: ScanFrame; analysis: Analysis; inputSource: string; diagnostics: ScanDiagnostics },
      requestMode: ScanRequest["mode"],
      analysisModel?: AnalysisModelId,
      skipAiSummary?: boolean
    ) => {
      // Use provided model or fall back to state
      const modelToUse = analysisModel || activeAnalysisModel;
      
      // If AI model was selected, generate Clinical Summary via Qwen
      let finalAnalysis = data.analysis;
      if (!skipAiSummary && modelToUse && modelToUse !== "none") {
        setScanState("analyzing");
        finalAnalysis = await generateClinicalSummary(data.frame, data.analysis);
      }

      setFrame(data.frame);
      setAnalysis(finalAnalysis);
      setCsiMeta(data.frame.csiMeta);
      setDiagnostics(data.diagnostics);
      setInputSource(data.inputSource);

      try {
        addScanRecord({
          inputSource: resolveHistoryInputSource(data.inputSource, requestMode),
          vitals: {
            heartRate: data.frame.vitals.heartRate,
            breathingRate: data.frame.vitals.breathingRate,
            hrv: data.frame.vitals.hrv,
          },
          bodyMetrics: {
            estimatedHeightCm: data.frame.bodyMetrics.estimatedHeightCm,
            shoulderWidthCm: data.frame.bodyMetrics.shoulderWidthCm,
            hipWidthCm: data.frame.bodyMetrics.hipWidthCm,
            torsoLengthCm: data.frame.bodyMetrics.torsoLengthCm,
            leftArmLengthCm: data.frame.bodyMetrics.leftArmLengthCm,
            leftLegLengthCm: data.frame.bodyMetrics.leftLegLengthCm,
          },
          bodyFatPercent: finalAnalysis.bodyFatPercent,
          bodyFatClassification: finalAnalysis.bodyFatClassification,
          estimatedWaistCm: finalAnalysis.estimatedWaistCm,
          dominantMotionHz: data.frame.temporal?.dominantMotionHz ?? 0,
          clinicalSummary: finalAnalysis.clinicalSummary,
          recommendations: finalAnalysis.recommendations,
          postureNotes: finalAnalysis.postureNotes,
          inferenceSource: finalAnalysis.source,
        });
      } catch (persistError) {
        setWarningMsg(buildPersistenceWarning(persistError));
      }
    },
    [activeAnalysisModel, generateClinicalSummary]
  );

  const runUploadScan = useCallback(
    async (request: ScanRequest) => {
      if (!request.file) throw new Error("Please choose a CSI file before starting upload mode.");

      const form = new FormData();
      form.append("csiFile", request.file);
      form.append("analysisModel", request.analysisModel ?? "none");
      if (request.calibrationProfileId) form.append("calibrationProfileId", request.calibrationProfileId);
      if (request.baselineId) form.append("baselineId", request.baselineId);
      if (typeof request.qualityGateMin === "number") form.append("qualityGateMin", String(request.qualityGateMin));
      if (typeof request.driftCompensationStrength === "number") {
        form.append("driftCompensationStrength", String(request.driftCompensationStrength));
      }

      const startResponse = await fetch("/api/scan/upload", { method: "POST", body: form });
      const startData = (await startResponse.json()) as UploadStartResponse;
      if (!startResponse.ok || !startData.success || !startData.jobId) {
        throw new Error(startData.error ?? "Upload job failed to start.");
      }

      const jobId = startData.jobId;
      for (let attempt = 0; attempt < 240; attempt++) {
        const progressResponse = await fetch(
          `/api/scan/upload/progress?jobId=${encodeURIComponent(jobId)}`,
          { cache: "no-store" }
        );
        const progressData = (await progressResponse.json()) as UploadProgressResponse;
        if (!progressResponse.ok || !progressData.success) {
          throw new Error(progressData.error?.message ?? "Unable to read upload progress.");
        }

        const progressValue = Number(progressData.progress ?? 0);
        setUploadProgress(Number.isFinite(progressValue) ? progressValue : null);

        const stage = String(progressData.stage ?? "");
        if (stage === "validating" || stage === "decoding_binary" || stage === "parsing") {
          setScanState("processing");
        } else if (stage === "inference") {
          setScanState(request.analysisModel && request.analysisModel !== "none" ? "analyzing" : "processing");
        }

        if (stage === "completed" && progressData.result) {
          await applyResult(progressData.result, request.mode, request.analysisModel);
          setScanState("results");
          setUploadProgress(100);
          return;
        }

        if (stage === "failed") {
          throw new Error(progressData.error?.message ?? "Upload processing failed.");
        }

        await delay(250);
      }

      throw new Error("Upload processing timed out.");
    },
    [applyResult]
  );

  const runDirectScan = useCallback(
    async (request: ScanRequest) => {
      const response = await fetch("/api/scan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: request.mode,
          livePort: request.livePort,
          analysisModel: request.analysisModel ?? "none",
          calibrationProfileId: request.calibrationProfileId,
          baselineId: request.baselineId,
          qualityGateMin: request.qualityGateMin,
          driftCompensationStrength: request.driftCompensationStrength,
        }),
      });

      const data = (await response.json()) as ScanResponse;
      if (!response.ok || !data.success || !data.frame || !data.analysis || !data.inputSource || !data.diagnostics) {
        throw new Error(data.error ?? "Scan failed.");
      }

      // Process result with AI summary if model selected
      await applyResult(
        {
          frame: data.frame,
          analysis: data.analysis,
          inputSource: data.inputSource,
          diagnostics: data.diagnostics,
        },
        request.mode,
        request.analysisModel
      );
      setScanState("results");
    },
    [applyResult]
  );

  const runImageScan = useCallback(
    async (request: ScanRequest) => {
      if (!request.imageFile) throw new Error("Please select an image file.");
      
      const form = new FormData();
      form.append("imageFile", request.imageFile);
      if (request.heightCm) form.append("heightCm", String(request.heightCm));
      if (request.weightKg) form.append("weightKg", String(request.weightKg));

      // Always show analyzing step for image mode since it takes time
      setScanState("analyzing");

      const response = await fetch("/api/scan/image", {
        method: "POST",
        body: form,
      });

      const data = (await response.json()) as ScanResponse;
      if (!response.ok || !data.success || !data.frame || !data.analysis || !data.inputSource || !data.diagnostics) {
        throw new Error(data.error ?? "Image Analysis failed.");
      }

      await applyResult({
        frame: data.frame,
        analysis: data.analysis,
        inputSource: data.inputSource,
        diagnostics: data.diagnostics,
      }, request.mode, request.analysisModel);

      setScanState("results");
      setUploadProgress(100);
    },
    [applyResult]
  );

  const runScan = useCallback(
    async (request: ScanRequest) => {
      setErrorMsg(null);
      setWarningMsg(null);
      setFrame(null);
      setAnalysis(null);
      setDiagnostics(null);
      setUploadProgress(null);
      setActiveMode(request.mode);
      setActiveAnalysisModel(request.analysisModel ?? "none");
      setScanState(request.mode === "live" ? "connecting" : "processing");

      try {
        if (request.mode === "upload") {
          await runUploadScan(request);
          return;
        }

        if (request.mode === "image") {
          await runImageScan(request);
          return;
        }

        await runDirectScan(request);
      } catch (error) {
        setErrorMsg(error instanceof Error ? error.message : String(error));
        setScanState("error");
        setUploadProgress(null);
      }
    },
    [runDirectScan, runUploadScan, runImageScan]
  );

  const handleReset = useCallback(() => {
    setScanState("idle");
    setFrame(null);
    setAnalysis(null);
    setDiagnostics(null);
    setErrorMsg(null);
    setWarningMsg(null);
    setUploadProgress(null);
    setActiveAnalysisModel("none");
  }, []);

  return {
    scanState,
    frame,
    analysis,
    csiMeta,
    diagnostics,
    inputSource,
    errorMsg,
    warningMsg,
    uploadProgress,
    activeMode,
    activeAnalysisModel,
    runScan,
    handleReset,
  };
}
